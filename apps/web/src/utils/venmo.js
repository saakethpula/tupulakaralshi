export function normalizeVenmoHandle(handle) {
    return (handle ?? "").replace(/^@+/, "").trim();
}
export function getVenmoUrl(handle) {
    const normalizedHandle = normalizeVenmoHandle(handle);
    return normalizedHandle ? `https://venmo.com/u/${normalizedHandle}` : "";
}
