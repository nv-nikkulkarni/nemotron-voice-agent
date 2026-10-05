// SPDX-License-Identifier: BSD-2-Clause
import { useRef, useState, type FormEvent } from "react";

const PAGE_SIZES = [8, 16, 32, 64] as const;
import { usePronunciationDefaults } from "../../api";
import { useApp } from "../../context/useApp";
import { useConnectionState } from "../../hooks/useConnectionState";

export function PronunciationEditor({ busy }: Readonly<{ busy: boolean }>) {
  const app = useApp();
  const { isConnected, isConnecting } = useConnectionState();
  const supported = /magpie/i.test(app.selectedTTS?.model ?? "");
  const {data, isLoading, isError, refetch} = usePronunciationDefaults();
  const [word, setWord] = useState("");
  const [ipa, setIpa] = useState("");
  const [search, setSearch] = useState("");
  const [pageSize, setPageSize] = useState<number>(PAGE_SIZES[0]);
  const [page, setPage] = useState(0);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const ipaInput = useRef<HTMLInputElement>(null);
  const locked = isConnected || isConnecting || busy || isLoading || isError || !supported;
  const defaults = data?.entries ?? {};
  const overrides = app.pronunciationOverrides;
  const merged = {...defaults};
  for (const [key, value] of Object.entries(overrides)) {
    for (const alias of Object.keys(merged)) if (alias.toLowerCase() === key.toLowerCase()) merged[alias] = value;
    merged[key] = value;
  }
  const customKey = (key: string) => Object.keys(overrides).find(word => word.toLowerCase() === key.toLowerCase());
  const entries = Object.entries(merged).sort(([left],[right]) => {
    const priority = (key: string) => key === "Nemotron" ? 0 : customKey(key) ? 1 : 2;
    return priority(left)-priority(right) || left.localeCompare(right);
  }).filter(([key,value]) => `${key} ${value}`.toLowerCase().includes(search.trim().toLowerCase()));
  const pageCount = Math.max(1, Math.ceil(entries.length / pageSize));
  const currentPage = Math.min(page, pageCount - 1);
  const visible = entries.slice(currentPage * pageSize, (currentPage + 1) * pageSize);
  const firstShown = entries.length ? currentPage * pageSize + 1 : 0;
  const save = (event: FormEvent) => {
    event.preventDefault(); setError(""); setMessage("");
    const grapheme = word.trim();
    let phones = ipa.trim();
    if ((phones.startsWith("/") && phones.endsWith("/")) || (phones.startsWith("[") && phones.endsWith("]"))) phones=phones.slice(1,-1).trim();
    if (!/^[\p{L}\p{M}\p{N}'’-]{1,80}$/u.test(grapheme)) {setError("Enter one word, up to 80 characters. Add separate rules for each word in a name.");return;}
    if (!phones || phones.length>200 || /[\p{C}\p{N}<>{}[\]/\\]/u.test(phones)) {setError("Enter IPA symbols, up to 200 characters, without markup or ARPAbet numbers.");return;}
    const existing = Object.keys(overrides).find(key=>key.toLowerCase()===grapheme.toLowerCase());
    if (!existing && Object.keys(overrides).length>=50) {setError("You can save up to 50 custom pronunciation rules. Remove one before adding another.");return;}
    const next = {...overrides};
    if (existing) delete next[existing];
    if (defaults[grapheme]!==phones) next[grapheme]=phones;
    app.setPronunciationOverrides(next);
    setMessage(`Saved pronunciation for ${grapheme}. Preview the voice to listen.`);
  };
  const remove = (key: string) => {
    const next = {...overrides};delete next[key];app.setPronunciationOverrides(next);
    setMessage(`Restored pronunciation for ${key}.`);setError("");
  };
  return <section className="studio-section pronunciation-studio" aria-labelledby="pronunciation-heading">
    <div className="studio-section__head"><span className="studio-section__number" aria-hidden="true">ɑ</span><div><h3 id="pronunciation-heading">Pronunciation fixes</h3><p>Set the sounds for names and words using the International Phonetic Alphabet (IPA).</p></div></div>
    <p className="set-hint">Your rules save in this browser for this assistant and apply to voice previews and new conversations. Removing a custom rule restores the deployed default.</p>
    {!supported && <p role="status" className="set-hint">IPA rules require a Magpie engine. Your saved rules remain available when you switch back.</p>}
    {isLoading && <p role="status">Loading pronunciation defaults…</p>}
    {isError && <p role="alert">Unable to load pronunciation defaults. <button type="button" className="btn-ghost" onClick={()=>void refetch()}>Retry</button></p>}
    <form onSubmit={save} className="pronunciation-form">
      <label className="set-field"><span className="set-field__label">Word</span><input className="set-select" value={word} disabled={locked} maxLength={80} placeholder="Nemotron" onChange={event=>{setWord(event.target.value);setError("");setMessage("");}} /></label>
      <label className="set-field"><span className="set-field__label">IPA pronunciation</span><input ref={ipaInput} className="set-select pronunciation-form__ipa" value={ipa} disabled={locked} maxLength={200} placeholder="ˈnimoʊˌtɹɑn" spellCheck={false} onChange={event=>{setIpa(event.target.value);setError("");setMessage("");}} /></label>
      <button type="submit" className="btn-secondary" disabled={locked}>Save pronunciation</button>
    </form>
    {error && <p role="alert" className="ex-config__error">{error}</p>}
    {message && <p role="status" className="set-hint">{message}</p>}
    {!!Object.keys(merged).length && <>
      <label className="set-field pronunciation-search"><span className="set-field__label">Find a pronunciation</span><input type="search" className="set-select" value={search} placeholder="Search deployed defaults and your fixes" onChange={event=>{setSearch(event.target.value);setPage(0);}} /></label>
      <div className="pronunciation-list" role="list" aria-label="Pronunciation rules">
        {visible.map(([key,value])=><div className={`pronunciation-rule ${customKey(key) ? "pronunciation-rule--custom" : ""}`} key={key} role="listitem">
          <div><strong>{key}</strong><small>{customKey(key) ? "Your fix" : "Deployed default"}</small></div><span className="pronunciation-rule__ipa">{value}</span>
          <div className="pronunciation-rule__actions"><button type="button" className="btn-ghost" disabled={locked} aria-label={`Edit pronunciation for ${key}`} onClick={()=>{setWord(key);setIpa(value);setMessage("");setError("");ipaInput.current?.focus();}}>Edit</button>
            {customKey(key) && <button type="button" className="btn-ghost" disabled={locked} aria-label={`Remove pronunciation fix for ${key}`} onClick={()=>remove(customKey(key)!)}>Remove</button>}</div>
        </div>)}
        {!visible.length && <p role="status" className="set-hint">No matching pronunciation rules.</p>}
      </div>
      <div className="pronunciation-pager" role="group" aria-label="Pronunciation list pages">
        <label className="pronunciation-pager__size">Rows per page
          <select value={pageSize} onChange={event=>{setPageSize(Number(event.target.value));setPage(0);}}>
            {PAGE_SIZES.map(size=><option key={size} value={size}>{size}</option>)}
          </select></label>
        <span className="pronunciation-pager__range" role="status">{firstShown}–{firstShown + visible.length - (visible.length ? 1 : 0)} of {entries.length}</span>
        <div className="pronunciation-pager__nav">
          <button type="button" className="btn-ghost" disabled={currentPage === 0} onClick={()=>setPage(currentPage-1)}>‹ Previous</button>
          <span>Page {currentPage + 1} of {pageCount}</span>
          <button type="button" className="btn-ghost" disabled={currentPage >= pageCount - 1} onClick={()=>setPage(currentPage+1)}>Next ›</button>
        </div>
      </div>
      <p className="set-hint">{Object.keys(overrides).length} / 50 custom fixes. Use the page controls or search to see every deployed default and your fixes.</p>
    </>}
  </section>;
}
