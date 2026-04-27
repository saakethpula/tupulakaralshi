export function normalizeVenmoHandle(handle: string | null | undefined) {
    return (handle ?? "").replace(/^@+/, "").trim();
}

export function getVenmoUrl(handle: string | null | undefined) {
    const normalizedHandle = normalizeVenmoHandle(handle);
    return normalizedHandle ? `https://venmo.com/u/${normalizedHandle}` : "";
}

export function getVenmoPaymentUrl(
    handle: string | null | undefined,
    amount?: number,
    note?: string
) {
    const baseUrl = getVenmoUrl(handle);

    if (!baseUrl) {
        return "";
    }

    const paymentUrl = new URL(baseUrl);
    paymentUrl.searchParams.set("txn", "pay");

    if (amount !== undefined && Number.isFinite(amount) && amount > 0) {
        paymentUrl.searchParams.set("amount", amount.toFixed(2));
    }

    if (note) {
        paymentUrl.searchParams.set("note", note);
    }

    return paymentUrl.toString();
}
