"use client";

import React, { useState } from "react";
import { ShieldCheck, Copy, Check } from "lucide-react";

interface HealthVaultHeaderProps {
  vaultId?: string;
}

export default function HealthVaultHeader({
  vaultId = "83942A",
}: HealthVaultHeaderProps) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(vaultId);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Fallback for older browsers
      const textArea = document.createElement("textarea");
      textArea.value = vaultId;
      document.body.appendChild(textArea);
      textArea.select();
      document.execCommand("copy");
      document.body.removeChild(textArea);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  return (
    <div className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-teal-600 to-teal-700 p-5 text-white shadow-lg">
      {/* Background decoration */}
      <div className="absolute top-0 right-0 -mt-4 -mr-4 h-24 w-24 rounded-full bg-white/10" />
      <div className="absolute bottom-0 left-0 -mb-6 -ml-6 h-20 w-20 rounded-full bg-white/5" />

      {/* Shield icon */}
      <div className="absolute top-4 right-4">
        <ShieldCheck className="h-8 w-8 text-white/30" />
      </div>

      {/* Content */}
      <div className="relative">
        <p className="text-xs font-medium text-teal-200 uppercase tracking-wider mb-1">
          Your Health Vault ID
        </p>
        <div className="flex items-center gap-3 mb-3">
          <span className="text-3xl font-bold font-mono tracking-widest">
            {vaultId}
          </span>
          <button
            onClick={handleCopy}
            className="rounded-lg bg-white/20 p-1.5 hover:bg-white/30 transition-colors"
            title="Copy Vault ID"
          >
            {copied ? (
              <Check className="h-4 w-4" />
            ) : (
              <Copy className="h-4 w-4" />
            )}
          </button>
        </div>

        {/* Badges */}
        <div className="flex flex-wrap gap-2">
          <span className="inline-flex items-center rounded-full bg-white/15 px-2.5 py-0.5 text-[10px] font-medium backdrop-blur-sm">
            FHIR R4 Ready
          </span>
          <span className="inline-flex items-center rounded-full bg-white/15 px-2.5 py-0.5 text-[10px] font-medium backdrop-blur-sm">
            End-to-End Encrypted
          </span>
        </div>
      </div>
    </div>
  );
}
