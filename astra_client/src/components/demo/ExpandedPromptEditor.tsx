// SPDX-License-Identifier: BSD-2-Clause
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

export function ExpandedPromptEditor({
  role, roleLabel, example, value, disabled, onChange, onRestore, onClose,
}: Readonly<{
  role: "frontend" | "backend";
  roleLabel?: string;
  example: string;
  value: string;
  disabled: boolean;
  onChange: (value: string) => void;
  onRestore: () => void;
  onClose: () => void;
}>) {
  const dialog = useRef<HTMLDialogElement>(null);
  const editor = useRef<HTMLTextAreaElement>(null);
  const [textSize, setTextSize] = useState(16);
  const title = `${roleLabel ?? (role === "frontend" ? "Frontend" : "Backend")} system prompt`;

  useEffect(() => {
    if (dialog.current && !dialog.current.open) {
      dialog.current.showModal();
      editor.current?.focus();
    }
  }, []);

  return createPortal(
    <dialog
      ref={dialog}
      className={`expanded-prompt-editor expanded-prompt-editor--${role}`}
      aria-labelledby="expanded-prompt-title"
      aria-describedby="expanded-prompt-description"
      onClose={onClose}
      onClick={(event) => {
        if (event.target !== event.currentTarget) return;
        const bounds = event.currentTarget.getBoundingClientRect();
        if (event.clientX < bounds.left || event.clientX > bounds.right
          || event.clientY < bounds.top || event.clientY > bounds.bottom) event.currentTarget.close();
      }}
    >
      <header className="expanded-prompt-editor__head">
        <div><p className="studio-eyebrow">PROMPT EDITOR</p><h2 id="expanded-prompt-title">{title}</h2><p className="expanded-prompt-editor__example">{example}</p></div>
        <button type="button" className="icon-btn" aria-label="Close expanded editor" onClick={() => dialog.current?.close()}>×</button>
      </header>
      <div className="expanded-prompt-editor__toolbar">
        <p id="expanded-prompt-description">{disabled ? "Prompt editing is unavailable while a session is active or prompts are loading." : "Changes save automatically in this browser for your next conversation."}</p>
        <div className="expanded-prompt-editor__text-size" role="group" aria-label="Editor text size">
          <span>Text size</span>
          <button type="button" aria-label="Decrease text size" disabled={textSize <= 14} onClick={() => setTextSize((size) => size - 2)}>A−</button>
          <output aria-live="polite" aria-label="Current text size">{textSize} px</output>
          <button type="button" aria-label="Increase text size" disabled={textSize >= 22} onClick={() => setTextSize((size) => size + 2)}>A+</button>
        </div>
      </div>
      <textarea
        ref={editor}
        className="expanded-prompt-editor__input"
        aria-label={`${title} expanded editor`}
        disabled={disabled}
        maxLength={32000}
        wrap="soft"
        spellCheck={false}
        style={{ fontSize: `${textSize}px` }}
        value={value}
        onChange={(event) => onChange(event.target.value)}
      />
      <footer className="expanded-prompt-editor__foot">
        <button type="button" className="btn-secondary" disabled={disabled} onClick={onRestore}>Restore {roleLabel?.toLowerCase() ?? role} default</button>
        <span className="expanded-prompt-editor__count">{value.length.toLocaleString()} / 32,000 characters</span>
        <button type="button" className="btn-primary" onClick={() => dialog.current?.close()}>Done</button>
      </footer>
    </dialog>,
    document.body,
  );
}
