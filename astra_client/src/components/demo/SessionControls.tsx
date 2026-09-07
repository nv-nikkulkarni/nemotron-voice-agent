// SPDX-FileCopyrightText: Copyright (c) 2024–2026, NVIDIA CORPORATION & AFFILIATES. All rights reserved.
// SPDX-License-Identifier: BSD-2-Clause

// The REC indicator + post-session feedback prompt. Recording start/finalize is
// owned by the session lifecycle (started on `live`, finalized during teardown),
// so the modal only opens once teardown is complete (`phase === "ended"`), which
// guarantees the download blob is ready and distinguishes a user end from an
// involuntary drop.

import { useRef } from "react";
import { demoConfig } from "../../config";
import { useApp } from "../../context/useApp";
import { useSessionLifecycle } from "../../hooks/useSessionLifecycle";
import { FeedbackModal } from "../FeedbackModal";
import { SessionTimer } from "./SessionTimer";

export function SessionControls() {
  const { selectedExample, currentSessionId } = useApp();
  const { phase, endedReason, isRecording, recording, downloadRecording, dismiss, beginSession, endSession } = useSessionLifecycle();
  const lastSessionId = useRef("");
  if (currentSessionId) lastSessionId.current = currentSessionId;
  const reason = endedReason ?? "user";
  const hasWebcamSidebar = selectedExample?.capabilities?.includes("webcam") ?? false;

  return (
    <>
      {phase === "live" && (
        <div
          className={`demo-hud${hasWebcamSidebar ? " demo-hud--with-webcam" : ""}`}
          aria-label="Conversation time and recording status"
        >
          <SessionTimer
            durationSeconds={demoConfig.sessionSeconds}
            onTimeout={() => void endSession("timeout")}
          />
          {isRecording && (
            <div className="rec-indicator" aria-live="polite"><span className="rec-dot" /> REC</div>
          )}
        </div>
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
