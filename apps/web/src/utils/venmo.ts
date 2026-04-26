export function normalizeVenmoHandle(handle: string | null | undefined) {
    return (handle ?? "").replace(/^@+/, "").trim();
}

export function getVenmoUrl(handle: string | null | undefined) {
    const normalizedHandle = normalizeVenmoHandle(handle);
    return normalizedHandle ? `https://venmo.com/u/${normalizedHandle}` : "";
}
