import { useState, type PointerEvent } from "react";
import type { CurrentUserResponse, Market } from "../../lib/api";
import type { TradeDraft } from "../../types/app";
import { formatMoney, formatPercent } from "../../utils/format";
import { getVenmoPaymentUrl, normalizeVenmoHandle } from "../../utils/venmo";

type MarketCardProps = {
    market: Market;
    profile: CurrentUserResponse;
    selectedGroupRole?: "ADMIN" | "MEMBER";
    maxBet: number;
    busyAction: string;
    draft: TradeDraft;
    onUpdateTradeDraft: (marketId: string, patch: Partial<TradeDraft>) => void;
    onSavePosition: (marketId: string) => Promise<void>;
    onConfirmPosition: (marketId: string, positionId: string) => Promise<void>;
    onRejectPosition: (marketId: string, positionId: string) => Promise<void>;
    onResolveMarket: (marketId: string, outcomeId: string) => Promise<void>;
    onConfirmMarketResolution: (marketId: string) => Promise<void>;
    onDeleteMarket: (marketId: string) => Promise<void>;
    onMarkPayoutSent: (marketId: string, payoutId: string) => Promise<void>;
    onRespondToPayout: (marketId: string, payoutId: string, received: boolean) => Promise<void>;
};

const OUTCOME_LINE_COLORS = ["#4f8f85", "#c98d82", "#c7a56a", "#6b7fa7", "#9b7bb4"];

function buildChartPath(points: Array<{ x: number; y: number }>) {
    return points.map((point, index) => `${index === 0 ? "M" : "L"} ${point.x.toFixed(2)} ${point.y.toFixed(2)}`).join(" ");
}

function formatChartTimestamp(timestamp?: string | null) {
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

function MarketOddsChart({ market }: { market: Market }) {
    const [activeIndex, setActiveIndex] = useState<number | null>(null);
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
    const handlePointerMove = (event: PointerEvent<SVGSVGElement>) => {
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

    return (
        <section className="market-chart" aria-label="Live odds chart">
            <div className="market-chart-heading">
                <span className="kicker">Live odds</span>
                <strong>{market.summary.leadingOutcome.label} {formatPercent(market.summary.leadingOutcome.price)}</strong>
            </div>
            <div className={`odds-chart-wrap ${activeIndex !== null ? "active" : ""}`}>
                <svg
                    className="odds-chart"
                    viewBox={`0 0 ${chartWidth} ${chartHeight}`}
                    role="img"
                    aria-label="Odds history"
                    tabIndex={0}
                    onPointerMove={handlePointerMove}
                    onPointerLeave={() => setActiveIndex(null)}
                    onFocus={() => setActiveIndex(priceHistory.length - 1)}
                    onBlur={() => setActiveIndex(null)}
                    onKeyDown={(event) => {
                        if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
                            event.preventDefault();
                            setActiveIndex((current) => {
                                const fallbackIndex = current ?? priceHistory.length - 1;
                                const direction = event.key === "ArrowLeft" ? -1 : 1;

                                return Math.min(priceHistory.length - 1, Math.max(0, fallbackIndex + direction));
                            });
                        }
                    }}
                >
                    <line x1="0" x2={chartWidth} y1={chartHeight * 0.25} y2={chartHeight * 0.25} />
                    <line x1="0" x2={chartWidth} y1={chartHeight * 0.5} y2={chartHeight * 0.5} />
                    <line x1="0" x2={chartWidth} y1={chartHeight * 0.75} y2={chartHeight * 0.75} />
                    {pathPoints.map((outcome) => (
                        <path key={outcome.id} d={outcome.path} style={{ stroke: outcome.color }} />
                    ))}
                    <line className="odds-crosshair" x1={activeX} x2={activeX} y1="0" y2={chartHeight} />
                    {activeOutcomes.map((outcome) => (
                        <circle
                            key={outcome.id}
                            className="odds-point"
                            cx={activeX}
                            cy={chartHeight - outcome.price * chartHeight}
                            r="1.35"
                            style={{ fill: outcome.color }}
                        />
                    ))}
                </svg>
                <div className="odds-tooltip" style={{ left: `clamp(80px, ${activeX}%, calc(100% - 80px))` }}>
                    <strong>{formatChartTimestamp(activeHistoryPoint?.timestamp)}</strong>
                    {activeOutcomes.map((outcome) => (
                        <span key={outcome.id}>
                            <i style={{ background: outcome.color }} />
                            {outcome.label} {formatPercent(outcome.price)}
                        </span>
                    ))}
                </div>
            </div>
            <div className="market-chart-legend">
                {pathPoints.map((outcome) => (
                    <span key={outcome.id}>
                        <i style={{ background: outcome.color }} />
                        {outcome.label} {formatPercent(outcome.price)}
                    </span>
                ))}
            </div>
        </section>
    );
}

export function MarketCard({
    market,
    profile,
    selectedGroupRole,
    maxBet,
    busyAction,
    draft,
    onUpdateTradeDraft,
    onSavePosition,
    onConfirmPosition,
    onRejectPosition,
    onResolveMarket,
    onConfirmMarketResolution,
    onDeleteMarket,
    onMarkPayoutSent,
    onRespondToPayout
}: MarketCardProps) {
    const canRemove = market.createdBy.id === profile.user.id || selectedGroupRole === "ADMIN";
    const resolutionOutcome = market.outcomes.find((outcome) => outcome.id === market.resolutionOutcomeId);
    const resolutionLabel = resolutionOutcome?.label ?? (market.resolution ? "YES" : "NO");
    const canConfirmResolution =
        market.status === "PENDING_RESOLUTION" &&
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
    const renderVenmoLink = (handle: string | null | undefined, fallback: string, amount?: number) => {
        const normalizedHandle = normalizeVenmoHandle(handle);
        const venmoUrl = getVenmoPaymentUrl(handle, amount, `Payment for ${market.question}`);

        return venmoUrl ? (
            <a className="venmo-link" href={venmoUrl} target="_blank" rel="noreferrer">
                @{normalizedHandle}
            </a>
        ) : (
            fallback
        );
    };

    return (
        <article className="market-panel">
            <div className="market-topline">
                <div>
                    <p className="kicker">
                        {market.isGeneral ? "General market" : `About ${market.targetUser?.displayName ?? "Family member"}`}
                    </p>
                    <h3>{market.question}</h3>
                </div>
                <span className={`status-pill ${market.status.toLowerCase()}`}>{market.status.replaceAll("_", " ")}</span>
            </div>

            {market.description ? <p className="market-copy">{market.description}</p> : null}

            <div className="market-stats">
                <div>
                    <span>Leader</span>
                    <strong>{market.summary.leadingOutcome.label}</strong>
                </div>
                <div>
                    <span>Total pot</span>
                    <strong>{formatMoney(market.summary.totalVolume)}</strong>
                </div>
                <div>
                    <span>Live stake</span>
                    <strong>{formatMoney(market.userPosition.totalAmount)}</strong>
                </div>
                <div>
                    <span>Closes</span>
                    <strong>{new Date(market.closesAt).toLocaleString()}</strong>
                </div>
            </div>

            <div className="market-rail">
                <div className="market-rail-card">
                    <span>Creator</span>
                    <strong>{market.createdBy.displayName}</strong>
                </div>
                <div className="market-rail-card">
                    <span>Leading outcome</span>
                    <strong>{market.summary.leadingOutcome.label} {formatPercent(market.summary.leadingOutcome.price)}</strong>
                </div>
                <div className="market-rail-card">
                    <span>Payout to you</span>
                    <strong>{formatMoney(payoutToYou)}</strong>
                </div>
            </div>

            <MarketOddsChart market={market} />

            <div className="trade-box">
                <div className="trade-toggle">
                    {market.outcomes.map((outcome) => (
                        <button
                            key={outcome.id}
                            type="button"
                            className={draft.outcomeId === outcome.id ? "toggle-button active-yes" : "toggle-button"}
                            onClick={() => onUpdateTradeDraft(market.id, { outcomeId: outcome.id })}
                        >
                            {outcome.label}
                        </button>
                    ))}
                </div>
                <input
                    type="number"
                    min="0"
                    value={draft.amount}
                    onChange={(event) => onUpdateTradeDraft(market.id, { amount: event.target.value })}
                    placeholder="Stake amount"
                />
                <button
                    className="primary-button"
                    type="button"
                    disabled={busyAction === `position-${market.id}` || market.status !== "OPEN" || isAboveMaxBet}
                    onClick={() => void onSavePosition(market.id)}
                >
                    {market.userPosition.totalAmount > 0 ? "Update position" : "Place position"}
                </button>
                <div className="payout-preview">
                    <span>Current payout if {selectedOutcome?.label ?? "your choice"} wins</span>
                    <strong>{formatMoney(currentPayout)}</strong>
                    <small>Net {currentNet >= 0 ? "+" : ""}{formatMoney(currentNet)}</small>
                </div>
                {market.status === "OPEN" ? (
                    <p className="trade-note">
                        {isAboveMaxBet ? (
                            <>The maximum per market is {formatMoney(maxBet)}.</>
                        ) : (
                            <>
                                After saving, send {formatMoney(topUpAmount)} to{" "}
                                {renderVenmoLink(market.venmoRecipient.venmoHandle, market.venmoRecipient.displayName, topUpAmount)}{" "}
                                so the market creator can escrow the pool.
                            </>
                        )}
                    </p>
                ) : null}
                {market.userPendingPosition.totalAmount > 0 ? (
                    <p className="trade-note pending-note">
                        Pending confirmation: {formatMoney(market.userPendingPosition.totalAmount)}. This will not affect the market until{" "}
                        {renderVenmoLink(market.venmoRecipient.venmoHandle, market.venmoRecipient.displayName, market.userPendingPosition.totalAmount)}{" "}
                        confirms receipt.
                    </p>
                ) : null}
            </div>

            {market.pendingConfirmations.length > 0 && market.createdBy.id === profile.user.id ? (
                <div className="settlement-box">
                    <div className="settlement-heading">
                        <span className="kicker">Pending receipts</span>
                        <strong>Confirm Venmo before the stake goes live</strong>
                    </div>
                    <div className="settlement-list">
                        {market.pendingConfirmations.map((pending) => (
                            <div key={pending.positionId} className="settlement-row pending-row">
                                <div>
                                    <span>{pending.displayName}</span>
                                    <small>
                                        {pending.outcomeLabel} for {formatMoney(pending.amount)}
                                    </small>
                                </div>
                                <div className="market-footer-actions">
                                    <button
                                        className="ghost-button yes-outline"
                                        type="button"
                                        disabled={busyAction === `confirm-${pending.positionId}`}
                                        onClick={() => void onConfirmPosition(market.id, pending.positionId)}
                                    >
                                        Confirm payment
                                    </button>
                                    <button
                                        className="ghost-button no-outline"
                                        type="button"
                                        disabled={busyAction === `reject-${pending.positionId}`}
                                        onClick={() => void onRejectPosition(market.id, pending.positionId)}
                                    >
                                        Reject
                                    </button>
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
            ) : null}

            {market.status === "PENDING_RESOLUTION" ? (
                <div className="settlement-box">
                    <div className="settlement-heading">
                        <span className="kicker">Resolution check</span>
                        <strong>
                            {market.resolutionProposedBy?.displayName ?? "An admin"} resolved this as {resolutionLabel}
                        </strong>
                    </div>
                    <p className="subtle-copy">
                        {market.resolutionConfirmationCount} of {market.requiredResolutionConfirmations} confirmations recorded.
                    </p>
                    {market.resolutionConfirmations.length > 0 ? (
                        <div className="settlement-list">
                            {market.resolutionConfirmations.map((confirmation) => (
                                <div key={confirmation.id} className="settlement-row">
                                    <div>
                                        <span>{confirmation.displayName}</span>
                                        <small>Confirmed resolution</small>
                                    </div>
                                    <strong>{resolutionLabel}</strong>
                                </div>
                            ))}
                        </div>
                    ) : null}
                    {canConfirmResolution ? (
                        <div className="market-footer-actions">
                            <button
                                className="ghost-button yes-outline"
                                type="button"
                                disabled={busyAction === `resolution-confirm-${market.id}`}
                                onClick={() => void onConfirmMarketResolution(market.id)}
                            >
                                Confirm {resolutionLabel}
                            </button>
                        </div>
                    ) : market.userResolutionConfirmation ? (
                        <p className="subtle-copy">You confirmed this resolution.</p>
                    ) : null}
                </div>
            ) : null}

            {market.status === "RESOLVED" && market.createdBy.id === profile.user.id ? (
                <div className="settlement-box">
                    <div className="settlement-heading">
                        <span className="kicker">Creator payout sheet</span>
                        <strong>
                            {market.creatorPayoutsPendingCount === 0
                                ? "All payouts confirmed"
                                : "Send these payouts and wait for winners to confirm"}
                        </strong>
                    </div>
                    {market.creatorPayouts.length === 0 ? (
                        <p className="subtle-copy">
                            Nobody backed the winning side. Refund bettors if you handled this market off-platform.
                        </p>
                    ) : (
                        <div className="settlement-list">
                            {market.payoutConfirmations.map((payout) => (
                                <div key={payout.id} className="settlement-row">
                                    <div>
                                        <span>{renderVenmoLink(payout.venmoHandle, payout.displayName, payout.amount)}</span>
                                        <small>{formatMoney(payout.amount)} · {payout.status.replaceAll("_", " ")}</small>
                                    </div>
                                    <div className="market-footer-actions">
                                        <strong>{formatMoney(payout.amount)}</strong>
                                        {payout.status !== "CONFIRMED" ? (
                                            <button
                                                className="ghost-button yes-outline"
                                                type="button"
                                                disabled={busyAction === `payout-sent-${payout.id}`}
                                                onClick={() => void onMarkPayoutSent(market.id, payout.id)}
                                            >
                                                {payout.status === "PENDING_CREATOR" ? "Mark paid" : payout.status === "DISPUTED" ? "Re-prompt winner" : "Sent, awaiting reply"}
                                            </button>
                                        ) : null}
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            ) : null}

            {market.status === "RESOLVED" && market.userPayoutConfirmation ? (
                <div className="settlement-box">
                    <div className="settlement-heading">
                        <span className="kicker">Payout check</span>
                        <strong>
                            {market.userPayoutConfirmation.status === "CONFIRMED"
                                ? "You already confirmed receipt"
                                : `Did ${market.createdBy.displayName} pay you ${formatMoney(market.userPayoutConfirmation.amount)}?`}
                        </strong>
                    </div>
                    {market.userPayoutConfirmation.status === "PENDING_RECIPIENT" || market.userPayoutConfirmation.status === "DISPUTED" ? (
                        <div className="market-footer-actions">
                            <button
                                className="ghost-button yes-outline"
                                type="button"
                                disabled={busyAction === `payout-response-${market.userPayoutConfirmation.id}`}
                                onClick={() => void onRespondToPayout(market.id, market.userPayoutConfirmation!.id, true)}
                            >
                                I was paid
                            </button>
                            <button
                                className="ghost-button no-outline"
                                type="button"
                                disabled={busyAction === `payout-response-${market.userPayoutConfirmation.id}`}
                                onClick={() => void onRespondToPayout(market.id, market.userPayoutConfirmation!.id, false)}
                            >
                                Not yet
                            </button>
                        </div>
                    ) : market.userPayoutConfirmation.status === "PENDING_CREATOR" ? (
                        <p className="subtle-copy">
                            Waiting for {market.createdBy.displayName} to mark your payout as sent.
                        </p>
                    ) : (
                        <p className="subtle-copy">
                            Thanks. This market will disappear once every winner confirms.
                        </p>
                    )}
                </div>
            ) : null}

            <div className="market-footer">
                <span className="subtle-copy">
                    Current odds: {market.summary.outcomes.map((outcome) => `${outcome.label} ${formatPercent(outcome.price)}`).join(" / ")}
                    {" | "}
                    Stake split: {market.summary.outcomes.map((outcome) => `${outcome.label} ${formatMoney(outcome.volume)}`).join(" / ")}
                </span>
                <div className="market-footer-actions">
                    {canRemove ? (
                        <button
                            className="ghost-button"
                            type="button"
                            disabled={busyAction === `delete-${market.id}` || market.status === "RESOLVED"}
                            onClick={() => void onDeleteMarket(market.id)}
                        >
                            Remove market
                        </button>
                    ) : null}
                    {selectedGroupRole === "ADMIN" && (market.status === "OPEN" || market.status === "CLOSED") ? (
                        <>
                            {market.outcomes.map((outcome) => (
                                <button
                                    key={outcome.id}
                                    className="ghost-button yes-outline"
                                    type="button"
                                    disabled={busyAction === `resolve-${market.id}`}
                                    onClick={() => void onResolveMarket(market.id, outcome.id)}
                                >
                                    Resolve {outcome.label}
                                </button>
                            ))}
                        </>
                    ) : null}
                </div>
            </div>
        </article>
    );
}
