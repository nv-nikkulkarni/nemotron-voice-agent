// SPDX-FileCopyrightText: Copyright (c) 2024–2026, NVIDIA CORPORATION & AFFILIATES. All rights reserved.
// SPDX-License-Identifier: BSD-2-Clause

import { createContext } from "react";
import type { AppState } from "./AppContext";

export const AppContext = createContext<AppState | null>(null);
