# SPDX-FileCopyrightText: Copyright (c) 2024–2026, NVIDIA CORPORATION & AFFILIATES. All rights reserved.
# SPDX-License-Identifier: BSD-2-Clause

"""Tool handlers for the generic_assistant pipeline.

Each handler is registered with ``NvidiaLLMService.register_function`` and
receives a :class:`pipecat.services.llm_service.FunctionCallParams`.  Handlers
deliver their result via ``params.result_callback``.

Live data sources (when keys are configured):
  - Currency conversion:  https://api.frankfurter.app  (no key required)
  - Stock prices:         Finnhub live quote (``FINNHUB_API_KEY``) — no mock fallback
  - Weather:              WeatherAPI live (``WEATHERAPI_KEY``) — no mock fallback
  - Web search:           Perplexity Sonar (``PERPLEXITY_API_KEY``)

The live tools (stock, weather, web_search) NEVER invent data: when their key is
unset or the upstream fails they return a speak-safe "unavailable" result instead of
a fabricated number. convert_currency keeps a static-rate fallback (deterministic math,
not invented market data).
"""

import asyncio
import os
import random
import re
from datetime import datetime
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

import httpx
from loguru import logger
from pipecat.services.llm_service import FunctionCallParams

# ---------------------------------------------------------------------------
# Currency conversion
# ---------------------------------------------------------------------------

# Static fallback rates (USD-based) — mirrors the client-side table.
_STATIC_RATES: dict[str, float] = {
    # Major
    "USD": 1.0,
    "EUR": 0.92,
    "GBP": 0.79,
    "JPY": 149.5,
    "CHF": 0.89,
    # Americas
    "CAD": 1.36,
    "AUD": 1.53,
    "MXN": 17.15,
    "BRL": 4.97,
    "ARS": 878.0,
    "CLP": 948.0,
    "COP": 3900.0,
    "PEN": 3.72,
    "UYU": 38.5,
    # Asia-Pacific
    "CNY": 7.24,
    "INR": 83.12,
    "KRW": 1325.0,
    "SGD": 1.34,
    "HKD": 7.82,
    "TWD": 31.8,
    "THB": 35.1,
    "MYR": 4.72,
    "IDR": 15700.0,
    "PHP": 56.5,
    "VND": 24500.0,
    "PKR": 278.0,
    "BDT": 110.0,
    "LKR": 305.0,
    "NPR": 133.0,
    # Europe
    "SEK": 10.42,
    "NOK": 10.55,
    "DKK": 6.88,
    "PLN": 4.02,
    "CZK": 22.8,
    "HUF": 355.0,
    "RON": 4.57,
    "BGN": 1.80,
    "HRK": 6.93,
    "RSD": 107.5,
    "TRY": 32.1,
    "RUB": 91.5,
    "UAH": 37.2,
    # Middle East & Africa
    "AED": 3.67,
    "SAR": 3.75,
    "QAR": 3.64,
    "KWD": 0.307,
    "BHD": 0.376,
    "OMR": 0.385,
    "ILS": 3.71,
    "EGP": 30.9,
    "ZAR": 18.6,
    "NGN": 1480.0,
    "KES": 129.0,
    "GHS": 12.5,
    "MAD": 9.98,
    "TND": 3.12,
    "ETB": 56.5,
    # Other
    "NZD": 1.63,
    "XAU": 0.000508,
    "XAG": 0.0426,
}

_HTTP_TIMEOUT = httpx.Timeout(connect=3.0, read=4.0, write=3.0, pool=2.0)


async def handle_convert_currency(params: FunctionCallParams) -> None:
    """Convert an amount between two currencies using live ECB rates with a static fallback."""
    args = params.arguments or {}
    try:
        amount = float(args.get("amount", 0) or 0)
    except (TypeError, ValueError):
        amount = 0.0
    from_currency = str(args.get("from_currency", "USD") or "USD").upper()
    to_currency = str(args.get("to_currency", "USD") or "USD").upper()

    # Try live rates from frankfurter.app (ECB data, no API key required).
    try:
        async with httpx.AsyncClient(timeout=_HTTP_TIMEOUT) as client:
            response = await client.get(
                "https://api.frankfurter.app/latest",
                params={"from": from_currency, "to": to_currency},
            )
        if response.status_code == 200:
            data = response.json()
            rate = data.get("rates", {}).get(to_currency)
            if isinstance(rate, (int, float)):
                converted = round(amount * rate, 2)
                await params.result_callback(
                    {
                        "converted_amount": converted,
                        "from_currency": from_currency,
                        "to_currency": to_currency,
                        "exchange_rate": rate,
                        "date": data.get("date"),
                        "source": "live",
                    }
                )
                return
    except (httpx.HTTPError, ValueError) as exc:
        logger.debug(f"convert_currency live lookup failed: {exc}")

    # Static fallback.
    from_rate = _STATIC_RATES.get(from_currency, 1.0)
    to_rate = _STATIC_RATES.get(to_currency, 1.0)
    converted = round((amount / from_rate) * to_rate, 2)
    await params.result_callback(
        {
            "converted_amount": converted,
            "from_currency": from_currency,
            "to_currency": to_currency,
            "exchange_rate": round(to_rate / from_rate, 6),
            "source": "static_fallback",
        }
    )


# ---------------------------------------------------------------------------
# BMI
# ---------------------------------------------------------------------------


async def handle_calculate_bmi(params: FunctionCallParams) -> None:
    """Calculate BMI given weight in kg and height in meters."""
    args = params.arguments or {}
    try:
        weight = float(args.get("weight_kg", 0) or 0)
        height = float(args.get("height_m", 1) or 1)
    except (TypeError, ValueError):
        await params.result_callback({"error": "weight_kg and height_m must be numeric"})
        return

    if weight < 0:
        await params.result_callback({"error": "weight_kg must be non-negative"})
        return
    if height <= 0:
        await params.result_callback({"error": "height_m must be greater than zero"})
        return

    bmi = round(weight / (height * height), 2)
    if bmi < 18.5:
        category = "Underweight"
    elif bmi < 25.0:
        category = "Normal weight"
    elif bmi < 30.0:
        category = "Overweight"
    else:
        category = "Obese"

    await params.result_callback({"bmi": bmi, "category": category, "weight_kg": weight, "height_m": height})


# ---------------------------------------------------------------------------
# Current date / time
# ---------------------------------------------------------------------------


async def handle_get_current_date_time(params: FunctionCallParams) -> None:
    """Return current date and time, optionally for a requested IANA timezone."""
    args = params.arguments or {}
    requested_tz = str(args.get("timezone", "") or "").strip()

    if requested_tz:
        try:
            tz = ZoneInfo(requested_tz)
        except (ZoneInfoNotFoundError, ValueError):
            await params.result_callback(
                {
                    "error": (
                        f"Unknown timezone {requested_tz!r}; expected an IANA name "
                        "(e.g. UTC, America/New_York, Asia/Kolkata)"
                    )
                }
            )
            return
        now = datetime.now(tz)
    else:
        now = datetime.now().astimezone()

    await params.result_callback(
        {
            "date": now.strftime("%Y-%m-%d"),
            "time": now.strftime("%H:%M:%S"),
            "datetime": now.strftime("%Y-%m-%d %H:%M:%S"),
            "iso8601": now.isoformat(timespec="seconds"),
            "day_of_week": now.strftime("%A"),
            "timezone": str(now.tzinfo) if now.tzinfo else "local",
        }
    )


# ---------------------------------------------------------------------------
# Stock prices
# ---------------------------------------------------------------------------

_FINNHUB_BASE_URL = os.getenv("FINNHUB_BASE_URL", "https://finnhub.io/api/v1").rstrip("/")
_FINNHUB_TIMEOUT = httpx.Timeout(10.0)

# Fast-path so a spoken company name maps straight to its ticker without a /search
# round-trip. Anything NOT here is resolved live via Finnhub's symbol-search endpoint.
# These are ticker mappings only — every price is fetched live, none are stored here.
_COMPANY_SYMBOLS: dict[str, str] = {
    "apple": "AAPL",
    "microsoft": "MSFT",
    "google": "GOOGL",
    "alphabet": "GOOGL",
    "amazon": "AMZN",
    "tesla": "TSLA",
    "nvidia": "NVDA",
    "meta": "META",
    "facebook": "META",
    "netflix": "NFLX",
    "amd": "AMD",
    "intel": "INTC",
    "broadcom": "AVGO",
    "qualcomm": "QCOM",
    "arm": "ARM",
    "salesforce": "CRM",
    "oracle": "ORCL",
    "ibm": "IBM",
    "uber": "UBER",
    "airbnb": "ABNB",
    "spotify": "SPOT",
    "jpmorgan": "JPM",
    "jp morgan": "JPM",
    "goldman sachs": "GS",
    "visa": "V",
    "mastercard": "MA",
    "johnson and johnson": "JNJ",
    "pfizer": "PFE",
    "exxon": "XOM",
    "exxonmobil": "XOM",
    "walmart": "WMT",
    "disney": "DIS",
    "boeing": "BA",
    "ford": "F",
    "general motors": "GM",
    "coca cola": "KO",
    "coca-cola": "KO",
    "pepsi": "PEP",
    "pepsico": "PEP",
}

# A plain US ticker such as AAPL / BRK.B (uppercase, ≤5 letters, optional class suffix).
_TICKER_RE = re.compile(r"^[A-Z]{1,5}(?:\.[A-Z]{1,3})?$")


async def _finnhub_resolve_symbol(client: httpx.AsyncClient, query: str, api_key: str) -> str | None:
    """Resolve a company name to a Finnhub ticker via /search (best US common-stock match)."""
    try:
        resp = await client.get(
            f"{_FINNHUB_BASE_URL}/search",
            params={"q": query, "token": api_key},
            headers={"Accept": "application/json"},
        )
        if resp.status_code != 200:
            return None
        results = (resp.json() or {}).get("result") or []
    except (httpx.HTTPError, ValueError) as exc:
        logger.debug(f"finnhub symbol search failed for {query!r}: {exc}")
        return None
    # Prefer a plain US common-stock ticker (no exchange/class qualifier like ".DE" or ":").
    for r in results:
        sym = str(r.get("symbol", "") or "")
        if sym and "." not in sym and ":" not in sym and r.get("type") == "Common Stock":
            return sym
    return str((results[0].get("symbol") if results else "") or "") or None


async def handle_get_stock_price(params: FunctionCallParams) -> None:
    """Fetch the LIVE stock price for a company/ticker via Finnhub (finnhub.io).

    No mock/fake data: on a missing key or upstream failure we return a speak-safe
    "unavailable" result (never an invented price); an unknown company returns a
    "couldn't find it" message. The API key comes from FINNHUB_API_KEY (an NVCF
    function secret, exported from /var/secrets/secrets.json like the NGC/Perplexity keys).
    """
    args = params.arguments or {}
    company_name = str(args.get("company_name", "") or "").strip()
    if not company_name:
        await params.result_callback({"error": "company_name is required"})
        return
    api_key = os.getenv("FINNHUB_API_KEY", "").strip()
    if not api_key:
        logger.warning("get_stock_price: FINNHUB_API_KEY unset")
        await params.result_callback(_tool_unavailable("get the stock price"))
        return

    fast = _COMPANY_SYMBOLS.get(company_name.lower())
    try:
        async with httpx.AsyncClient(timeout=_FINNHUB_TIMEOUT) as client:
            # Resolve to a ticker: fast-path map -> looks-like-a-ticker -> live search.
            symbol = fast or (company_name.upper() if _TICKER_RE.match(company_name.strip()) else None)
            if symbol is None:
                symbol = await _finnhub_resolve_symbol(client, company_name, api_key)
            if not symbol:
                await params.result_callback({"error": f"I couldn't find a stock for '{company_name}'."})
                return
            resp = await client.get(
                f"{_FINNHUB_BASE_URL}/quote",
                params={"symbol": symbol, "token": api_key},
                headers={"Accept": "application/json"},
            )
    except httpx.HTTPError as exc:
        logger.warning(f"get_stock_price request failed for {company_name!r}: {exc}")
        await params.result_callback(_tool_unavailable("get the stock price"))
        return

    if resp.status_code != 200:
        logger.warning(f"get_stock_price non-200 for {symbol!r}: {resp.status_code}")
        await params.result_callback(_tool_unavailable("get the stock price"))
        return
    try:
        data = resp.json()
    except ValueError:
        await params.result_callback(_tool_unavailable("get the stock price"))
        return

    # Finnhub returns c=0 (and pc=0) for an unknown/unsupported symbol.
    current = data.get("c")
    if not current:
        await params.result_callback({"error": f"I couldn't find a stock price for '{company_name}'."})
        return
    await params.result_callback(
        {
            "company": company_name,
            "symbol": symbol,
            "price": round(float(current), 2),
            "currency": "USD",
            "previous_close": data.get("pc"),
            "day_high": data.get("h"),
            "day_low": data.get("l"),
            "change": data.get("d"),
            "change_percent": data.get("dp"),
            "source": "live (finnhub)",
        }
    )


# ---------------------------------------------------------------------------
# Random number
# ---------------------------------------------------------------------------


async def handle_generate_random_number(params: FunctionCallParams) -> None:
    """Return a uniformly random integer in ``[min, max]`` (defaults 1..100)."""
    args = params.arguments or {}
    try:
        low = int(args.get("min", 1) or 1)
        high = int(args.get("max", 100) or 100)
    except (TypeError, ValueError):
        await params.result_callback({"error": "min and max must be integers"})
        return

    if low > high:
        await params.result_callback({"error": "min must be less than or equal to max"})
        return

    await params.result_callback({"result": random.randint(low, high), "min": low, "max": high})


# ---------------------------------------------------------------------------
# Weather
# ---------------------------------------------------------------------------

_WEATHER_BASE_URL = os.getenv("WEATHERAPI_BASE_URL", "https://api.weatherapi.com/v1").rstrip("/")
_WEATHER_TIMEOUT = httpx.Timeout(10.0)


async def handle_get_weather(params: FunctionCallParams) -> None:
    """Fetch LIVE current weather for a city via WeatherAPI (api.weatherapi.com).

    No mock/fake data: on a missing key or upstream failure we return a speak-safe
    "unavailable" result (never invented weather); an unknown city returns a "couldn't
    find it" message. The API key comes from WEATHERAPI_KEY (an NVCF function secret,
    exported from /var/secrets/secrets.json like the NGC/Perplexity keys).
    """
    args = params.arguments or {}
    city = str(args.get("city", "") or "").strip()
    if not city:
        await params.result_callback({"error": "city is required"})
        return
    use_fahrenheit = str(args.get("units", "") or "").lower().startswith("f")
    api_key = os.getenv("WEATHERAPI_KEY", "").strip()
    if not api_key:
        logger.warning("get_weather: WEATHERAPI_KEY unset")
        await params.result_callback(_tool_unavailable("get the weather"))
        return
    try:
        async with httpx.AsyncClient(timeout=_WEATHER_TIMEOUT) as client:
            response = await client.get(
                f"{_WEATHER_BASE_URL}/current.json",
                params={"key": api_key, "q": city, "aqi": "no"},
                headers={"Accept": "application/json"},
            )
    except httpx.HTTPError as exc:
        logger.warning(f"get_weather request failed for {city!r}: {exc}")
        await params.result_callback(_tool_unavailable("get the weather"))
        return

    if response.status_code == 400:  # WeatherAPI: no matching location
        await params.result_callback({"error": f"I couldn't find weather for '{city}'."})
        return
    if response.status_code != 200:
        logger.warning(f"get_weather non-200 for {city!r}: {response.status_code}")
        await params.result_callback(_tool_unavailable("get the weather"))
        return
    try:
        data = response.json()
    except ValueError:
        await params.result_callback(_tool_unavailable("get the weather"))
        return

    loc = data.get("location", {})
    cur = data.get("current", {})
    if not cur:
        await params.result_callback(_tool_unavailable("get the weather"))
        return
    temp = f"{cur.get('temp_f')}°F" if use_fahrenheit else f"{cur.get('temp_c')}°C"
    feels = f"{cur.get('feelslike_f')}°F" if use_fahrenheit else f"{cur.get('feelslike_c')}°C"
    await params.result_callback(
        {
            "city": loc.get("name"),
            "region": loc.get("region"),
            "country": loc.get("country"),
            "local_time": loc.get("localtime"),
            "condition": cur.get("condition", {}).get("text"),
            "temperature": temp,
            "feels_like": feels,
            "humidity": f"{cur.get('humidity')}%",
            "wind": f"{cur.get('wind_kph')} kph {cur.get('wind_dir')}",
            "visibility": f"{cur.get('vis_km')} km",
            "uv_index": cur.get("uv"),
            "source": "live (weatherapi)",
        }
    )


# ---------------------------------------------------------------------------
# News headlines (dummy)
# ---------------------------------------------------------------------------

_DUMMY_HEADLINES = [
    "Global markets rally as inflation data comes in lower than expected",
    "Scientists announce breakthrough in renewable energy storage",
    "World leaders gather for climate summit in Geneva",
    "Tech giant unveils next-generation AI assistant",
    "Major earthquake strikes Pacific region; tsunami warnings issued",
]


async def handle_get_news_headlines(params: FunctionCallParams) -> None:
    """Return three dummy news headlines."""
    args = params.arguments or {}
    result: dict = {"headlines": _DUMMY_HEADLINES[:3]}
    if args.get("country"):
        result["country"] = args["country"]
    if args.get("category"):
        result["category"] = args["category"]
    result["note"] = "dummy result - not live news"
    await params.result_callback(result)


# ---------------------------------------------------------------------------
# Web search (Perplexity Sonar via the NVIDIA inference gateway)
# ---------------------------------------------------------------------------

# OpenAI-compatible LiteLLM proxy. Key + endpoint come from env (set by the chart from a
# secret, like the NVIDIA key). Empty key -> the tool reports it isn't configured.
_PPLX_BASE_URL = os.getenv("PERPLEXITY_BASE_URL", "https://inference-api.nvidia.com/v1").rstrip("/")
_PPLX_MODEL = os.getenv("PERPLEXITY_MODEL", "perplexity/perplexity/sonar")
_CITATION_RE = re.compile(r"\[\d+\]")  # strip "[9]"-style citation markers (unspeakable)


def _tool_unavailable(action: str) -> dict:
    """A speak-safe tool-failure result.

    NEVER return raw error strings / HTTP codes as a tool result: the LLM relays tool
    output to the user (the prompt tells it to answer from what the tool returns), so a
    raw `{"error": "…HTTP 429"}` gets read aloud. Instead hand the model a friendly line
    to speak and an explicit instruction not to mention the failure details.
    """
    return {
        "status": "unavailable",
        "assistant_should_say": f"I wasn't able to {action} right now. Would you like me to try again?",
        "instruction": "Say the assistant_should_say text (or a close paraphrase). Do NOT mention "
        "errors, status codes, or that a tool failed.",
    }


_WEB_SEARCH_RETRY_STATUSES = {429, 500, 502, 503, 504}
_WEB_SEARCH_MAX_ATTEMPTS = 2


async def handle_web_search(params: FunctionCallParams) -> None:
    """Answer a query with live web search via Perplexity Sonar.

    Transient upstream failures (rate-limit / 5xx / timeout) are retried once, then fall
    back to a speak-safe "unavailable" result — never a raw HTTP error the bot would read.
    """
    args = params.arguments or {}
    query = str(args.get("query") or "").strip()
    if not query:
        await params.result_callback({"error": "query is required"})
        return
    api_key = os.getenv("PERPLEXITY_API_KEY", "").strip()
    if not api_key:
        logger.warning("web_search: PERPLEXITY_API_KEY unset")
        await params.result_callback(_tool_unavailable("search the web"))
        return
    payload = {
        "model": _PPLX_MODEL,
        "messages": [
            {
                "role": "system",
                "content": (
                    "You are a concise web-search assistant for a voice agent. Answer in one or "
                    "two short spoken sentences with the key fact. Do not use markdown, lists, "
                    "URLs, or bracketed citation numbers."
                ),
            },
            {"role": "user", "content": query},
        ],
        "temperature": 0.2,
        "max_tokens": 400,
    }
    data = None
    for attempt in range(1, _WEB_SEARCH_MAX_ATTEMPTS + 1):
        try:
            async with httpx.AsyncClient(timeout=30.0) as client:
                resp = await client.post(
                    f"{_PPLX_BASE_URL}/chat/completions",
                    headers={"Authorization": f"Bearer {api_key}"},
                    json=payload,
                )
                resp.raise_for_status()
                data = resp.json()
            break
        except httpx.HTTPStatusError as exc:
            status = exc.response.status_code
            logger.warning(f"web_search HTTP {status} (attempt {attempt}): {exc.response.text[:200]}")
            if status in _WEB_SEARCH_RETRY_STATUSES and attempt < _WEB_SEARCH_MAX_ATTEMPTS:
                await asyncio.sleep(0.5 * attempt)
                continue
            await params.result_callback(_tool_unavailable("look that up"))
            return
        except Exception as exc:  # noqa: BLE001 — timeouts / transport / decode
            logger.warning(f"web_search error (attempt {attempt}): {exc}")
            if attempt < _WEB_SEARCH_MAX_ATTEMPTS:
                await asyncio.sleep(0.5 * attempt)
                continue
            await params.result_callback(_tool_unavailable("look that up"))
            return

    answer = _CITATION_RE.sub("", (data.get("choices") or [{}])[0].get("message", {}).get("content", "")).strip()
    if not answer:
        await params.result_callback(_tool_unavailable("find an answer for that"))
        return
    result: dict = {"answer": answer}
    sources = data.get("citations") or data.get("search_results")
    if sources:  # kept for the transcript/UI; not spoken
        result["sources"] = sources[:3]
    await params.result_callback(result)


# ---------------------------------------------------------------------------
# Registry
# ---------------------------------------------------------------------------

TOOL_HANDLERS = {
    "convert_currency": handle_convert_currency,
    "calculate_bmi": handle_calculate_bmi,
    "get_current_date_time": handle_get_current_date_time,
    "get_stock_price": handle_get_stock_price,
    "generate_random_number": handle_generate_random_number,
    "get_weather": handle_get_weather,
    "get_news_headlines": handle_get_news_headlines,
    "web_search": handle_web_search,
}
