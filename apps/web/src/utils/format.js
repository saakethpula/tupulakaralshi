export function tomorrowAtNoon() {
    const date = new Date();
    date.setDate(date.getDate() + 1);
    date.setHours(12, 0, 0, 0);
    return date.toISOString().slice(0, 16);
}
export function formatMoney(amount) {
    return new Intl.NumberFormat("en-US", {
        style: "currency",
        currency: "USD",
        maximumFractionDigits: 0
    }).format(amount);
}
export function formatSignedMoney(amount) {
    if (amount === 0) {
        return formatMoney(0);
    }
    return `${amount > 0 ? "+" : "-"}${formatMoney(Math.abs(amount))}`;
}
