/** Plane `secrets.token_urlsafe(16)`: 16 random bytes in base64url. Only `[A-Za-z0-9_-]` so it passes `publicBoardAnchorSchema`. */
function tokenUrlsafe(bytes = 16): string {
  const data = crypto.getRandomValues(new Uint8Array(bytes))
  return btoa(String.fromCharCode(...data))
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replaceAll('=', '')
}

/** PD-1386 `get_anchor`: the default of `DeployBoard.anchor`, a random URL-safe token. */
export function getAnchor(): string {
  return tokenUrlsafe(16)
}
