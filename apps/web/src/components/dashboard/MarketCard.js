import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
import { useState } from "react";
import { formatMoney, formatPercent } from "../../utils/format";
import { getVenmoPaymentUrl, normalizeVenmoHandle } from "../../utils/venmo";
const OUTCOME_LINE_COLORS = ["#4f8f85", "#c98d82", "#c7a56a", "#6b7fa7", "#9b7bb4"];
function buildChartPath(points) {
    return points.map((point, index) => `${index === 0 ? "M" : "L"} ${point.x.toFixed(2)} ${point.y.toFixed(2)}`).join(" ");
}
function formatChartTimestamp(timestamp) {
    if (!timestamp) {
        return "Opening odds";
    }
    return new Date(timestamp).toLocaleString([], {
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit"
    });
}
function MarketOddsChart({ market }) {
    const [activeIndex, setActiveIndex] = useState(null);
    const chartWidth = 100;
    const chartHeight = 48;
    const existingPriceHistory = market.summary.priceHistory ?? [];
    const priceHistory = existingPriceHistory.length > 0
        ? existingPriceHistory
        : [{ timestamp: null, outcomes: market.summary.outcomes.map(({ id, label, price }) => ({ id, label, price })) }];
    const visibleActiveIndex = activeIndex ?? priceHistory.length - 1;
    const activeHistoryPoint = priceHistory[visibleActiveIndex] ?? priceHistory[priceHistory.length - 1];
    const activeX = priceHistory.length > 1
        ? (visibleActiveIndex / (priceHistory.length - 1)) * chartWidth
        : chartWidth;
    const handlePointerMove = (event) => {
        const rect = event.currentTarget.getBoundingClientRect();
        const pointerRatio = Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width));
        const nextIndex = Math.round(pointerRatio * Math.max(0, priceHistory.length - 1));
        setActiveIndex(nextIndex);
    };
    const pathPoints = market.summary.outcomes.map((outcome) => {
        const historyPoints = priceHistory.map((historyPoint, index) => {
            const divisor = Math.max(1, priceHistory.length - 1);
            const price = historyPoint.outcomes.find((entry) => entry.id === outcome.id)?.price ?? outcome.price;
            return {
                x: (index / divisor) * chartWidth,
                y: chartHeight - price * chartHeight
            };
        });
        const normalizedPoints = historyPoints.length === 1
            ? [{ x: 0, y: historyPoints[0].y }, { x: chartWidth, y: historyPoints[0].y }]
            : historyPoints;
        return {
            ...outcome,
            color: OUTCOME_LINE_COLORS[market.summary.outcomes.findIndex((entry) => entry.id === outcome.id) % OUTCOME_LINE_COLORS.length],
            path: buildChartPath(normalizedPoints)
        };
    });
    const activeOutcomes = market.summary.outcomes.map((outcome) => ({
        ...outcome,
        color: OUTCOME_LINE_COLORS[market.summary.outcomes.findIndex((entry) => entry.id === outcome.id) % OUTCOME_LINE_COLORS.length],
        price: activeHistoryPoint?.outcomes.find((entry) => entry.id === outcome.id)?.price ?? outcome.price
    }));
    return (_jsxs("section", { className: "market-chart", "aria-label": "Live odds chart", children: [_jsxs("div", { className: "market-chart-heading", children: [_jsx("span", { className: "kicker", children: "Live odds" }), _jsxs("strong", { children: [market.summary.leadingOutcome.label, " ", formatPercent(market.summary.leadingOutcome.price)] })] }), _jsxs("div", { className: `odds-chart-wrap ${activeIndex !== null ? "active" : ""}`, children: [_jsxs("svg", { className: "odds-chart", viewBox: `0 0 ${chartWidth} ${chartHeight}`, role: "img", "aria-label": "Odds history", tabIndex: 0, onPointerMove: handlePointerMove, onPointerLeave: () => setActiveIndex(null), onFocus: () => setActiveIndex(priceHistory.length - 1), onBlur: () => setActiveIndex(null), onKeyDown: (event) => {
                            if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
                                event.preventDefault();
                                setActiveIndex((current) => {
                                    const fallbackIndex = current ?? priceHistory.length - 1;
                                    const direction = event.key === "ArrowLeft" ? -1 : 1;
                                    return Math.min(priceHistory.length - 1, Math.max(0, fallbackIndex + direction));
                                });
                            }
                        }, children: [_jsx("line", { x1: "0", x2: chartWidth, y1: chartHeight * 0.25, y2: chartHeight * 0.25 }), _jsx("line", { x1: "0", x2: chartWidth, y1: chartHeight * 0.5, y2: chartHeight * 0.5 }), _jsx("line", { x1: "0", x2: chartWidth, y1: chartHeight * 0.75, y2: chartHeight * 0.75 }), pathPoints.map((outcome) => (_jsx("path", { d: outcome.path, style: { stroke: outcome.color } }, outcome.id))), _jsx("line", { className: "odds-crosshair", x1: activeX, x2: activeX, y1: "0", y2: chartHeight }), activeOutcomes.map((outcome) => (_jsx("circle", { className: "odds-point", cx: activeX, cy: chartHeight - outcome.price * chartHeight, r: "1.35", style: { fill: outcome.color } }, outcome.id)))] }), _jsxs("div", { className: "odds-tooltip", style: { left: `clamp(80px, ${activeX}%, calc(100% - 80px))` }, children: [_jsx("strong", { children: formatChartTimestamp(activeHistoryPoint?.timestamp) }), activeOutcomes.map((outcome) => (_jsxs("span", { children: [_jsx("i", { style: { background: outcome.color } }), outcome.label, " ", formatPercent(outcome.price)] }, outcome.id)))] })] }), _jsx("div", { className: "market-chart-legend", children: pathPoints.map((outcome) => (_jsxs("span", { children: [_jsx("i", { style: { background: outcome.color } }), outcome.label, " ", formatPercent(outcome.price)] }, outcome.id))) })] }));
}
export function MarketCard({ market, profile, selectedGroupRole, maxBet, busyAction, requireVenmoForBets, draft, onUpdateTradeDraft, onSavePosition, onConfirmPosition, onRejectPosition, onResolveMarket, onConfirmMarketResolution, onDeleteMarket, onMarkPayoutSent, onRespondToPayout }) {
    const canRemove = market.createdBy.id === profile.user.id || selectedGroupRole === "ADMIN";
    const resolutionOutcome = market.outcomes.find((outcome) => outcome.id === market.resolutionOutcomeId);
    const resolutionLabel = resolutionOutcome?.label ?? (market.resolution ? "YES" : "NO");
    const canConfirmResolution = market.status === "PENDING_RESOLUTION" &&
        market.resolutionProposedBy?.id !== profile.user.id &&
        !market.userResolutionConfirmation;
    const existingUserTotal = market.userPosition.totalAmount + market.userPendingPosition.totalAmount;
    const confirmedUserTotal = market.userPosition.totalAmount;
    const draftAmount = Number(draft.amount || "0");
    const topUpAmount = Math.max(0, draftAmount - existingUserTotal);
    const isAboveMaxBet = draftAmount > maxBet;
    const selectedOutcome = market.summary.outcomes.find((outcome) => outcome.id === draft.outcomeId);
    const selectedUserAmount = market.userPosition.outcomeAmounts.find((outcome) => outcome.id === draft.outcomeId)?.amount ?? 0;
    const previewTotalPot = Math.max(0, market.summary.totalVolume - confirmedUserTotal + draftAmount);
    const previewOutcomeVolume = Math.max(0, (selectedOutcome?.volume ?? 0) - selectedUserAmount + draftAmount);
    const currentPayout = draftAmount > 0 && previewOutcomeVolume > 0
        ? Math.floor((previewTotalPot * draftAmount) / previewOutcomeVolume)
        : 0;
    const currentNet = currentPayout - draftAmount;
    const placedUserOutcome = market.userPosition.outcomeAmounts.find((outcome) => outcome.amount > 0);
    const placedOutcome = market.summary.outcomes.find((outcome) => outcome.id === placedUserOutcome?.id);
    const projectedPlacedPayout = placedUserOutcome && placedOutcome && placedOutcome.volume > 0
        ? Math.floor((market.summary.totalVolume * placedUserOutcome.amount) / placedOutcome.volume)
        : 0;
    const payoutToYou = market.status === "RESOLVED" ? market.userPayout : projectedPlacedPayout;
    const renderVenmoLink = (handle, fallback, amount) => {
        const normalizedHandle = normalizeVenmoHandle(handle);
        const venmoUrl = getVenmoPaymentUrl(handle, amount, `Payment for ${market.question}`);
        return venmoUrl ? (_jsxs("a", { className: "venmo-link", href: venmoUrl, target: "_blank", rel: "noreferrer", children: ["@", normalizedHandle] })) : (fallback);
    };
    return (_jsxs("article", { className: "market-panel", children: [_jsxs("div", { className: "market-topline", children: [_jsxs("div", { children: [_jsx("p", { className: "kicker", children: market.isGeneral ? "General market" : `About ${market.targetUser?.displayName ?? "Family member"}` }), _jsx("h3", { children: market.question })] }), _jsx("span", { className: `status-pill ${market.status.toLowerCase()}`, children: market.status.replaceAll("_", " ") })] }), market.description ? _jsx("p", { className: "market-copy", children: market.description }) : null, _jsxs("div", { className: "market-stats", children: [_jsxs("div", { children: [_jsx("span", { children: "Leader" }), _jsx("strong", { children: market.summary.leadingOutcome.label })] }), _jsxs("div", { children: [_jsx("span", { children: "Total pot" }), _jsx("strong", { children: formatMoney(market.summary.totalVolume) })] }), _jsxs("div", { children: [_jsx("span", { children: "Live stake" }), _jsx("strong", { children: formatMoney(market.userPosition.totalAmount) })] }), _jsxs("div", { children: [_jsx("span", { children: "Closes" }), _jsx("strong", { children: new Date(market.closesAt).toLocaleString() })] })] }), _jsxs("div", { className: "market-rail", children: [_jsxs("div", { className: "market-rail-card", children: [_jsx("span", { children: "Creator" }), _jsx("strong", { children: market.createdBy.displayName })] }), _jsxs("div", { className: "market-rail-card", children: [_jsx("span", { children: "Leading outcome" }), _jsxs("strong", { children: [market.summary.leadingOutcome.label, " ", formatPercent(market.summary.leadingOutcome.price)] })] }), _jsxs("div", { className: "market-rail-card", children: [_jsx("span", { children: "Payout to you" }), _jsx("strong", { children: formatMoney(payoutToYou) })] })] }), _jsx(MarketOddsChart, { market: market }), _jsxs("div", { className: "trade-box", children: [_jsx("div", { className: "trade-toggle", children: market.outcomes.map((outcome) => (_jsx("button", { type: "button", className: draft.outcomeId === outcome.id ? "toggle-button active-yes" : "toggle-button", onClick: () => onUpdateTradeDraft(market.id, { outcomeId: outcome.id }), children: outcome.label }, outcome.id))) }), _jsx("input", { type: "number", min: "0", value: draft.amount, onChange: (event) => onUpdateTradeDraft(market.id, { amount: event.target.value }), placeholder: "Stake amount" }), _jsx("button", { className: "primary-button", type: "button", disabled: busyAction === `position-${market.id}` || market.status !== "OPEN" || isAboveMaxBet, onClick: () => void onSavePosition(market.id), children: market.userPosition.totalAmount > 0 ? "Update position" : "Place position" }), _jsxs("div", { className: "payout-preview", children: [_jsxs("span", { children: ["Current payout if ", selectedOutcome?.label ?? "your choice", " wins"] }), _jsx("strong", { children: formatMoney(currentPayout) }), _jsxs("small", { children: ["Net ", currentNet >= 0 ? "+" : "", formatMoney(currentNet)] })] }), market.status === "OPEN" ? (_jsx("p", { className: "trade-note", children: isAboveMaxBet ? (_jsxs(_Fragment, { children: ["The maximum per market is ", formatMoney(maxBet), "."] })) : (requireVenmoForBets ? (_jsxs(_Fragment, { children: ["After saving, send ", formatMoney(topUpAmount), " to", " ", renderVenmoLink(market.venmoRecipient.venmoHandle, market.venmoRecipient.displayName, topUpAmount), " ", "and wait for creator confirmation before your stake goes live."] })) : (_jsxs(_Fragment, { children: ["Your stake is live immediately. You can optionally send ", formatMoney(topUpAmount), " to", " ", renderVenmoLink(market.venmoRecipient.venmoHandle, market.venmoRecipient.displayName, topUpAmount), " ", "on good faith to settle with the market creator."] }))) })) : null, requireVenmoForBets && market.userPendingPosition.totalAmount > 0 ? (_jsxs("p", { className: "trade-note pending-note", children: ["Pending confirmation: ", formatMoney(market.userPendingPosition.totalAmount), ". This will not affect the market until", " ", renderVenmoLink(market.venmoRecipient.venmoHandle, market.venmoRecipient.displayName, market.userPendingPosition.totalAmount), " ", "confirms receipt."] })) : null] }), requireVenmoForBets && market.pendingConfirmations.length > 0 && market.createdBy.id === profile.user.id ? (_jsxs("div", { className: "settlement-box", children: [_jsxs("div", { className: "settlement-heading", children: [_jsx("span", { className: "kicker", children: "Pending receipts" }), _jsx("strong", { children: "Confirm Venmo before the stake goes live" })] }), _jsx("div", { className: "settlement-list", children: market.pendingConfirmations.map((pending) => (_jsxs("div", { className: "settlement-row pending-row", children: [_jsxs("div", { children: [_jsx("span", { children: pending.displayName }), _jsxs("small", { children: [pending.outcomeLabel, " for ", formatMoney(pending.amount)] })] }), _jsxs("div", { className: "market-footer-actions", children: [_jsx("button", { className: "ghost-button yes-outline", type: "button", disabled: busyAction === `confirm-${pending.positionId}`, onClick: () => void onConfirmPosition(market.id, pending.positionId), children: "Confirm payment" }), _jsx("button", { className: "ghost-button no-outline", type: "button", disabled: busyAction === `reject-${pending.positionId}`, onClick: () => void onRejectPosition(market.id, pending.positionId), children: "Reject" })] })] }, pending.positionId))) })] })) : null, !requireVenmoForBets && market.createdBy.id === profile.user.id && market.creatorCollections.length > 0 ? (_jsxs("div", { className: "settlement-box", children: [_jsxs("div", { className: "settlement-heading", children: [_jsx("span", { className: "kicker", children: "Collection sheet" }), _jsx("strong", { children: "People who currently owe you for this market" })] }), _jsx("div", { className: "settlement-list", children: market.creatorCollections.map((entry) => (_jsxs("div", { className: "settlement-row", children: [_jsxs("div", { children: [_jsx("span", { children: renderVenmoLink(entry.venmoHandle, entry.displayName, entry.amount) }), _jsxs("small", { children: [formatMoney(entry.amount), " total stake"] })] }), _jsx("strong", { children: formatMoney(entry.amount) })] }, entry.userId))) })] })) : null, market.status === "PENDING_RESOLUTION" ? (_jsxs("div", { className: "settlement-box", children: [_jsxs("div", { className: "settlement-heading", children: [_jsx("span", { className: "kicker", children: "Resolution check" }), _jsxs("strong", { children: [market.resolutionProposedBy?.displayName ?? "An admin", " resolved this as ", resolutionLabel] })] }), _jsxs("p", { className: "subtle-copy", children: [market.resolutionConfirmationCount, " of ", market.requiredResolutionConfirmations, " confirmations recorded."] }), market.resolutionConfirmations.length > 0 ? (_jsx("div", { className: "settlement-list", children: market.resolutionConfirmations.map((confirmation) => (_jsxs("div", { className: "settlement-row", children: [_jsxs("div", { children: [_jsx("span", { children: confirmation.displayName }), _jsx("small", { children: "Confirmed resolution" })] }), _jsx("strong", { children: resolutionLabel })] }, confirmation.id))) })) : null, canConfirmResolution ? (_jsx("div", { className: "market-footer-actions", children: _jsxs("button", { className: "ghost-button yes-outline", type: "button", disabled: busyAction === `resolution-confirm-${market.id}`, onClick: () => void onConfirmMarketResolution(market.id), children: ["Confirm ", resolutionLabel] }) })) : market.userResolutionConfirmation ? (_jsx("p", { className: "subtle-copy", children: "You confirmed this resolution." })) : null] })) : null, market.status === "RESOLVED" && market.createdBy.id === profile.user.id ? (_jsxs("div", { className: "settlement-box", children: [_jsxs("div", { className: "settlement-heading", children: [_jsx("span", { className: "kicker", children: "Creator payout sheet" }), _jsx("strong", { children: market.creatorPayoutsPendingCount === 0
                                    ? "All payouts confirmed"
                                    : "Send these payouts and wait for winners to confirm" })] }), market.creatorPayouts.length === 0 ? (_jsx("p", { className: "subtle-copy", children: "Nobody backed the winning side. Refund bettors if you handled this market off-platform." })) : (_jsx("div", { className: "settlement-list", children: market.payoutConfirmations.map((payout) => (_jsxs("div", { className: "settlement-row", children: [_jsxs("div", { children: [_jsx("span", { children: renderVenmoLink(payout.venmoHandle, payout.displayName, payout.amount) }), _jsxs("small", { children: [formatMoney(payout.amount), " \u00B7 ", payout.status.replaceAll("_", " ")] })] }), _jsxs("div", { className: "market-footer-actions", children: [_jsx("strong", { children: formatMoney(payout.amount) }), payout.status !== "CONFIRMED" ? (_jsx("button", { className: "ghost-button yes-outline", type: "button", disabled: busyAction === `payout-sent-${payout.id}`, onClick: () => void onMarkPayoutSent(market.id, payout.id), children: payout.status === "PENDING_CREATOR" ? "Mark paid" : payout.status === "DISPUTED" ? "Re-prompt winner" : "Sent, awaiting reply" })) : null] })] }, payout.id))) }))] })) : null, market.status === "RESOLVED" && market.userPayoutConfirmation ? (_jsxs("div", { className: "settlement-box", children: [_jsxs("div", { className: "settlement-heading", children: [_jsx("span", { className: "kicker", children: "Payout check" }), _jsx("strong", { children: market.userPayoutConfirmation.status === "CONFIRMED"
                                    ? "You already confirmed receipt"
                                    : `Did ${market.createdBy.displayName} pay you ${formatMoney(market.userPayoutConfirmation.amount)}?` })] }), market.userPayoutConfirmation.status === "PENDING_RECIPIENT" || market.userPayoutConfirmation.status === "DISPUTED" ? (_jsxs("div", { className: "market-footer-actions", children: [_jsx("button", { className: "ghost-button yes-outline", type: "button", disabled: busyAction === `payout-response-${market.userPayoutConfirmation.id}`, onClick: () => void onRespondToPayout(market.id, market.userPayoutConfirmation.id, true), children: "I was paid" }), _jsx("button", { className: "ghost-button no-outline", type: "button", disabled: busyAction === `payout-response-${market.userPayoutConfirmation.id}`, onClick: () => void onRespondToPayout(market.id, market.userPayoutConfirmation.id, false), children: "Not yet" })] })) : market.userPayoutConfirmation.status === "PENDING_CREATOR" ? (_jsxs("p", { className: "subtle-copy", children: ["Waiting for ", market.createdBy.displayName, " to mark your payout as sent."] })) : (_jsx("p", { className: "subtle-copy", children: "Thanks. This market will disappear once every winner confirms." }))] })) : null, _jsxs("div", { className: "market-footer", children: [_jsxs("span", { className: "subtle-copy", children: ["Current odds: ", market.summary.outcomes.map((outcome) => `${outcome.label} ${formatPercent(outcome.price)}`).join(" / "), " | ", "Stake split: ", market.summary.outcomes.map((outcome) => `${outcome.label} ${formatMoney(outcome.volume)}`).join(" / ")] }), _jsxs("div", { className: "market-footer-actions", children: [canRemove ? (_jsx("button", { className: "ghost-button", type: "button", disabled: busyAction === `delete-${market.id}` || market.status === "RESOLVED", onClick: () => void onDeleteMarket(market.id), children: "Remove market" })) : null, selectedGroupRole === "ADMIN" && (market.status === "OPEN" || market.status === "CLOSED") ? (_jsx(_Fragment, { children: market.outcomes.map((outcome) => (_jsxs("button", { className: "ghost-button yes-outline", type: "button", disabled: busyAction === `resolve-${market.id}`, onClick: () => void onResolveMarket(market.id, outcome.id), children: ["Resolve ", outcome.label] }, outcome.id))) })) : null] })] })] }));
}
