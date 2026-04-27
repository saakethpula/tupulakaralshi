import type { CurrentUserResponse, Market } from "../../lib/api";
import type { TradeDraft } from "../../types/app";
import { formatMoney } from "../../utils/format";
import { getVenmoUrl, normalizeVenmoHandle } from "../../utils/venmo";

type MarketCardProps = {
    market: Market;
    profile: CurrentUserResponse;
    selectedGroupRole?: "ADMIN" | "MEMBER";
    busyAction: string;
    draft: TradeDraft;
    onUpdateTradeDraft: (marketId: string, patch: Partial<TradeDraft>) => void;
    onSavePosition: (marketId: string) => Promise<void>;
    onConfirmPosition: (marketId: string, positionId: string) => Promise<void>;
    onRejectPosition: (marketId: string, positionId: string) => Promise<void>;
    onResolveMarket: (marketId: string, resolution: boolean) => Promise<void>;
    onConfirmMarketResolution: (marketId: string) => Promise<void>;
    onDeleteMarket: (marketId: string) => Promise<void>;
    onMarkPayoutSent: (marketId: string, payoutId: string) => Promise<void>;
    onRespondToPayout: (marketId: string, payoutId: string, received: boolean) => Promise<void>;
};

export function MarketCard({
    market,
    profile,
    selectedGroupRole,
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
    const recipientHandle = normalizeVenmoHandle(market.venmoRecipient.venmoHandle);
    const recipientUrl = getVenmoUrl(market.venmoRecipient.venmoHandle);
    const resolutionSide = market.resolution ? "YES" : "NO";
    const canConfirmResolution =
        market.status === "PENDING_RESOLUTION" &&
        market.resolutionProposedBy?.id !== profile.user.id &&
        !market.userResolutionConfirmation;

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
                    <span>YES</span>
                    <strong>{Math.round(market.summary.yesPrice * 100)}%</strong>
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
                    <span>Leading side</span>
                    <strong>{market.summary.leadingSide}</strong>
                </div>
                <div className="market-rail-card">
                    <span>Payout to you</span>
                    <strong>{formatMoney(market.userPayout)}</strong>
                </div>
            </div>

            <div className="trade-box">
                <div className="trade-toggle">
                    <button
                        type="button"
                        className={draft.side === "YES" ? "toggle-button active-yes" : "toggle-button"}
                        onClick={() => onUpdateTradeDraft(market.id, { side: "YES" })}
                    >
                        YES
                    </button>
                    <button
                        type="button"
                        className={draft.side === "NO" ? "toggle-button active-no" : "toggle-button"}
                        onClick={() => onUpdateTradeDraft(market.id, { side: "NO" })}
                    >
                        NO
                    </button>
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
                    disabled={busyAction === `position-${market.id}` || market.status !== "OPEN"}
                    onClick={() => void onSavePosition(market.id)}
                >
                    {market.userPosition.totalAmount > 0 ? "Update position" : "Place position"}
                </button>
                {market.status === "OPEN" ? (
                    <p className="trade-note">
                        After saving, send {formatMoney(Number(draft.amount || "0"))} to{" "}
                        {recipientUrl ? (
                            <a className="venmo-link" href={recipientUrl} target="_blank" rel="noreferrer">
                                @{recipientHandle}
                            </a>
                        ) : (
                            market.venmoRecipient.displayName
                        )}{" "}
                        so the market creator can escrow the pool.
                    </p>
                ) : null}
                {market.userPendingPosition.totalAmount > 0 ? (
                    <p className="trade-note pending-note">
                        Pending confirmation: {formatMoney(market.userPendingPosition.totalAmount)}. This will not affect the market until{" "}
                        {recipientUrl ? (
                            <a className="venmo-link" href={recipientUrl} target="_blank" rel="noreferrer">
                                @{recipientHandle}
                            </a>
                        ) : (
                            market.venmoRecipient.displayName
                        )}{" "}
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
                                        {pending.side} for {formatMoney(pending.amount)}
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
                            {market.resolutionProposedBy?.displayName ?? "An admin"} resolved this as {resolutionSide}
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
                                    <strong>{resolutionSide}</strong>
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
                                Confirm {resolutionSide}
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
                                        <span>{payout.displayName}</span>
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
                    Current split: {formatMoney(market.userPosition.yesAmount)} YES / {formatMoney(market.userPosition.noAmount)} NO
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
                            <button
                                className="ghost-button yes-outline"
                                type="button"
                                disabled={busyAction === `resolve-${market.id}`}
                                onClick={() => void onResolveMarket(market.id, true)}
                            >
                                Resolve YES
                            </button>
                            <button
                                className="ghost-button no-outline"
                                type="button"
                                disabled={busyAction === `resolve-${market.id}`}
                                onClick={() => void onResolveMarket(market.id, false)}
                            >
                                Resolve NO
                            </button>
                        </>
                    ) : null}
                </div>
            </div>
        </article>
    );
}
