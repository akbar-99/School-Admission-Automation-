import { NextResponse } from "next/server";
import crypto from "node:crypto";
import { config } from "@/lib/config";

function base64url(input: Buffer | string): string {
  return Buffer.from(input)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

export async function GET() {
  const key = config.googleSheets.privateKey;
  const diagnostics = {
    clientEmail: config.googleSheets.clientEmail,
    spreadsheetId: config.googleSheets.spreadsheetId,
    privateKeyLength: key.length,
    privateKeyStartsCorrectly: key.startsWith("-----BEGIN PRIVATE KEY-----"),
    privateKeyEndsCorrectly: key.trim().endsWith("-----END PRIVATE KEY-----"),
    privateKeyLineCount: key.split("\n").length,
    privateKeyFirst40: key.slice(0, 40),
    privateKeyLast40: key.slice(-40),
  };

  try {
    const now = Math.floor(Date.now() / 1000);
    const header = { alg: "RS256", typ: "JWT" };
    const claim = {
      iss: config.googleSheets.clientEmail,
      scope: "https://www.googleapis.com/auth/spreadsheets",
      aud: "https://oauth2.googleapis.com/token",
      exp: now + 3600,
      iat: now,
    };
    const unsigned = `${base64url(JSON.stringify(header))}.${base64url(JSON.stringify(claim))}`;
    const signer = crypto.createSign("RSA-SHA256");
    signer.update(unsigned);
    const signature = base64url(signer.sign(key));
    const jwt = `${unsigned}.${signature}`;

    const res = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
        assertion: jwt,
      }),
    });
    const text = await res.text();
    return NextResponse.json({ diagnostics, tokenStatus: res.status, tokenResponse: text });
  } catch (err) {
    return NextResponse.json({
      diagnostics,
      signingError: err instanceof Error ? err.message : String(err),
    });
  }
}
