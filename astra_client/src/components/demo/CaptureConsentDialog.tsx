// SPDX-License-Identifier: BSD-2-Clause
import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";

export function CaptureConsentDialog({ onConfirm, onClose }: Readonly<{
  onConfirm: (consent: boolean) => void;
  onClose: () => void;
}>) {
  const dialog = useRef<HTMLDialogElement>(null);
  const submitted = useRef(false);
  useEffect(() => { if (dialog.current && !dialog.current.open) dialog.current.showModal(); }, []);
  const confirm = (consent: boolean) => {
    if (submitted.current) return;
    submitted.current = true;
    dialog.current?.close();
    onConfirm(consent);
  };
  return createPortal(<dialog ref={dialog} className="capture-consent" aria-labelledby="capture-consent-title" aria-describedby="capture-consent-description" onClose={onClose}>
    <div className="capture-consent__head"><span className="capture-consent__symbol" aria-hidden="true">〰</span><button type="button" className="icon-btn" aria-label="Cancel starting conversation" onClick={() => dialog.current?.close()}>×</button></div>
    <p className="studio-eyebrow">BEFORE WE START</p>
    <h2 id="capture-consent-title">Help improve the conversation?</h2>
    <p id="capture-consent-description">May we save this session’s microphone and assistant audio, transcript, and diagnostic logs for quality review and debugging by the NVIDIA team?</p>
    <p className="capture-consent__note">Your choice applies to this session. You can continue without saving a quality-review capture.</p>
    <div className="capture-consent__actions"><button type="button" className="btn-secondary" onClick={() => confirm(false)}>Continue without saving</button><button type="button" className="btn-primary" onClick={() => confirm(true)}>Allow and start</button></div>
  </dialog>,document.body);
}
