"use client";
import { createContext } from "react";
// Portals live outside the hidden page DOM but retain its React context.
export const AccessVisibilityContext = createContext(true);
