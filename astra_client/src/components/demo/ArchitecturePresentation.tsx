// SPDX-License-Identifier: BSD-2-Clause
import { useState, useCallback, useEffect } from "react";
import { RTVIEvent } from "@pipecat-ai/client-js";
import { useRTVIClientEvent } from "@pipecat-ai/client-react";
import { useApp } from "../../context/useApp";
import { BUNDLED_ARCHITECTURE_IMAGES, onArchitectureRequest } from "../../demo/architecture";

export function ArchitecturePresentation() {
  const { currentSessionId } = useApp();
  const [presentation, setPresentation] = useState({ session: "", image: "" });
  const image = presentation.session === currentSessionId ? presentation.image : "";
  useRTVIClientEvent(RTVIEvent.ServerMessage, useCallback((message: { type?: string; kind?: string; image_url?: string }) => {
    if (message.type === "presentation" && message.kind === "architecture"
      && ["/api/architecture/generic.svg", "/api/architecture/omni.svg"].includes(message.image_url ?? "")) {
      setPresentation({ session: currentSessionId, image: BUNDLED_ARCHITECTURE_IMAGES[message.image_url!] ?? message.image_url! });
    }
  }, [currentSessionId]));
  useEffect(() => onArchitectureRequest((requested) => setPresentation({ session: currentSessionId, image: requested })), [currentSessionId]);
  return image ? <figure className="architecture-presentation"><img src={image} alt="Current voice agent architecture" />
    <figcaption>Current voice agent design</figcaption>
    <button className="btn-ghost" onClick={() => setPresentation({ session: currentSessionId, image: "" })}>Close image</button></figure> : null;
}
