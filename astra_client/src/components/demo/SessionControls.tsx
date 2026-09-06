// SPDX-FileCopyrightText: Copyright (c) 2024–2026, NVIDIA CORPORATION & AFFILIATES. All rights reserved.
// SPDX-License-Identifier: BSD-2-Clause

// The REC indicator + post-session feedback prompt. Recording start/finalize is
// owned by the session lifecycle (started on `live`, finalized during teardown),
// so the modal only opens once teardown is complete (`phase === "ended"`), which
// guarantees the download blob is ready and distinguishes a user end from an
// involuntary drop.

import { useRef } from "react";
import { useApp } from "../../context/useApp";
import { useSessionLifecycle } from "../../hooks/useSessionLifecycle";
import { FeedbackModal } from "../FeedbackModal";

export function SessionControls() {
  const { selectedExample, currentSessionId } = useApp();
  const { phase, endedReason, isRecording, recording, downloadRecording, dismiss, beginSession } = useSessionLifecycle();
  const lastSessionId = useRef("");
  if (currentSessionId) lastSessionId.current = currentSessionId;
  const reason = endedReason ?? "user";

  return (
    <>
      {isRecording && (
        <div className="rec-indicator" aria-live="polite"><span className="rec-dot" /> REC</div>
      )}
      <FeedbackModal
        open={phase === "ended"}
        summary={{ example: selectedExample?.key, sessionId: currentSessionId || lastSessionId.current, endedReason: reason }}
        endedReason={reason}
        hasRecording={!!recording}
        onDownloadRecording={downloadRecording}
        onReconnect={reason !== "user" ? () => void beginSession() : undefined}
        onClose={dismiss}
      />
    </>
  );
}
