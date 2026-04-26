import type { FormEvent } from "react";
import type { CurrentUserResponse } from "../../lib/api";
import type { GroupSetupMode, TradeDraft, TutorialHoverTarget, TutorialPracticeStep } from "../../types/app";
import { formatMoney, formatSignedMoney } from "../../utils/format";

type OnboardingScreenProps = {
    profile: CurrentUserResponse;
    statusMessage: string;
    error: string;
    busyAction: string;
    needsVenmoHandle: boolean;
    needsFirstGroup: boolean;
    onboardingReady: boolean;
    canStartPractice: boolean;
    onboardingStep: number;
    setOnboardingStep: (updater: (current: number) => number) => void;
    groupSetupMode: GroupSetupMode;
    setGroupSetupMode: (mode: GroupSetupMode) => void;
    referralJoinCode: string;
    joinCode: string;
    setJoinCode: (value: string) => void;
    groupName: string;
    setGroupName: (value: string) => void;
    venmoHandle: string;
    setVenmoHandle: (value: string) => void;
    tutorialDraft: TradeDraft;
    tutorialAmountNumber: number;
    tutorialPracticeStep: TutorialPracticeStep;
    tutorialHoverTarget: TutorialHoverTarget;
    setTutorialHoverTarget: (target: TutorialHoverTarget) => void;
    tutorialBetPlaced: boolean;
    tutorialPrompt: string;
    tutorialVenmoUrl: string;
    onTutorialSideChange: (side: "YES" | "NO") => void;
    onTutorialAmountChange: (amount: string) => void;
    onTutorialPlaceBet: () => void;
    onTutorialPaymentSent: () => void;
    onSaveVenmoHandle: (event: FormEvent<HTMLFormElement>) => Promise<void>;
    onJoinGroup: (event: FormEvent<HTMLFormElement>) => Promise<void>;
    onCreateGroup: (event: FormEvent<HTMLFormElement>) => Promise<void>;
    onCompleteTutorial: () => Promise<void>;
};

const TOTAL_ONBOARDING_STEPS = 4;

export function OnboardingScreen({
    profile,
    statusMessage,
    error,
    busyAction,
    needsVenmoHandle,
    needsFirstGroup,
    onboardingReady,
    canStartPractice,
    onboardingStep,
    setOnboardingStep,
    groupSetupMode,
    setGroupSetupMode,
    referralJoinCode,
    joinCode,
    setJoinCode,
    groupName,
    setGroupName,
    venmoHandle,
    setVenmoHandle,
    tutorialDraft,
    tutorialAmountNumber,
    tutorialPracticeStep,
    setTutorialHoverTarget,
    tutorialBetPlaced,
    tutorialPrompt,
    tutorialVenmoUrl,
    onTutorialSideChange,
    onTutorialAmountChange,
    onTutorialPlaceBet,
    onTutorialPaymentSent,
    onSaveVenmoHandle,
    onJoinGroup,
    onCreateGroup,
    onCompleteTutorial
}: OnboardingScreenProps) {
    const progressCount = onboardingStep + 1;
    const isIntroSlide = onboardingStep === 0;
    const isVenmoSlide = onboardingStep === 1;
    const isGroupSlide = onboardingStep === 2;
    const isPracticeSlide = onboardingStep === 3;

    return (
        <main className="shell app-shell">
            <section className="onboarding-shell">
                <article className="onboarding-hero">
                    <div className="hero-copy">
                        <p className="kicker onboarding-kicker">Interactive tutorial</p>
                        <h1>Learn the flow before you touch the live board.</h1>
                        <p className="hero-lede">
                            First we connect your payment handle, then we get you into a group, then we walk through one complete practice market so the live dashboard feels obvious.
                        </p>
                    </div>
                    <div className="onboarding-progress">
                        <div className={onboardingStep === 0 ? "progress-card active" : "progress-card complete"}>
                            <span className="preview-label">Start</span>
                            <strong>Tutorial overview</strong>
                            <p>
                                A quick preview of the setup and practice flow before you enter the real app.
                            </p>
                        </div>
                        <div
                            className={
                                onboardingStep === 1
                                    ? "progress-card active"
                                    : needsVenmoHandle
                                        ? "progress-card"
                                        : "progress-card complete"
                            }
                        >
                            <span className="preview-label">Step 1</span>
                            <strong>{needsVenmoHandle ? "Add your Venmo" : "Venmo linked"}</strong>
                            <p>
                                {needsVenmoHandle
                                    ? "Save the handle people should use when paying or settling with you."
                                    : `Payments can now be routed to @${profile.user.venmoHandle}.`}
                            </p>
                        </div>
                        <div
                            className={
                                onboardingStep === 2
                                    ? "progress-card active"
                                    : needsFirstGroup
                                        ? "progress-card"
                                        : "progress-card complete"
                            }
                        >
                            <span className="preview-label">Step 2</span>
                            <strong>{needsFirstGroup ? "Join or create a group" : "Group connected"}</strong>
                            <p>
                                {needsFirstGroup
                                    ? "Choose one path on a dedicated screen instead of juggling both forms at once."
                                    : `You’re connected to ${profile.groups[0]?.name ?? "your first group"}.`}
                            </p>
                        </div>
                        <div
                            className={
                                isPracticeSlide
                                    ? "progress-card active"
                                    : canStartPractice
                                        ? "progress-card complete"
                                        : "progress-card"
                            }
                        >
                            <span className="preview-label">Step 3</span>
                            <strong>{canStartPractice ? "Live tutorial" : "Finish setup to unlock tutorial"}</strong>
                            <p>Practice a fake bet, see the payment-confirmation flow, and then unlock the real dashboard.</p>
                        </div>
                    </div>
                </article>

                <section className="status-banner">
                    <span>{statusMessage}</span>
                    {error ? <strong>{error}</strong> : null}
                </section>

                <section className="onboarding-grid">
                    <article className="panel onboarding-slide-panel">
                        <div className="panel-heading onboarding-slide-heading">
                            <div>
                                <p className="kicker">
                                    {isIntroSlide
                                        ? "Tutorial cover"
                                        : isVenmoSlide
                                            ? "Step 1 of 3"
                                            : isGroupSlide
                                                ? "Step 2 of 3"
                                                : "Live practice"}
                                </p>
                                <h2>
                                    {isIntroSlide
                                        ? "Before you enter the dashboard"
                                        : isVenmoSlide
                                            ? "Add the Venmo handle people should pay"
                                            : isGroupSlide
                                                ? "Join a group or create your first one"
                                                : "Try a fake market before using the real app"}
                                </h2>
                            </div>
                            <span className="subtle-copy">Screen {progressCount} of {TOTAL_ONBOARDING_STEPS}</span>
                        </div>

                        {isIntroSlide ? (
                            <div className="slideshow-stage tutorial-cover">
                                <div className="cover-badge">Interactive walkthrough</div>
                                <p className="cover-title">We’ll set up your account, then rehearse the real flow one step at a time.</p>
                                <p className="cover-copy">
                                    Each screen has one job. Save your payment handle, join or create a group, then place one practice position so the live board already feels familiar.
                                </p>
                                <div className="cover-highlights">
                                    <div className="cover-highlight">
                                        <strong>1. Save Venmo</strong>
                                        <p>Make sure everyone knows where to send money for market payments and settlement.</p>
                                    </div>
                                    <div className="cover-highlight">
                                        <strong>2. Pick your group path</strong>
                                        <p>Use one full screen to either join an existing group or start a new one yourself.</p>
                                    </div>
                                    <div className="cover-highlight">
                                        <strong>3. Learn the flow</strong>
                                        <p>Place a fake bet, see the fake Venmo step, and unlock the real dashboard after you practice.</p>
                                    </div>
                                </div>
                            </div>
                        ) : null}

                        {isVenmoSlide ? (
                            <div className="slideshow-stage">
                                <div className="slide-callout">
                                    <span className="preview-label">Payout setup</span>
                                    <strong>{needsVenmoHandle ? "Add your handle to continue" : `Saved as @${profile.user.venmoHandle}`}</strong>
                                    <p>This step gets payment instructions right anywhere the app asks people to fund or settle a position.</p>
                                </div>

                                <form onSubmit={(event) => void onSaveVenmoHandle(event)} className="compact-form form-stack single-step-form">
                                    <span className="subtle-copy">Where should people Venmo you?</span>
                                    <input
                                        value={venmoHandle}
                                        onChange={(event) => setVenmoHandle(event.target.value)}
                                        placeholder="@yourhandle"
                                        required
                                    />
                                    <button className="secondary-button" type="submit" disabled={busyAction === "venmo"}>
                                        {needsVenmoHandle ? "Save Venmo handle" : "Update Venmo handle"}
                                    </button>
                                </form>
                            </div>
                        ) : null}

                        {isGroupSlide ? (
                            <div className="slideshow-stage">
                                <div className="group-setup-switcher">
                                    <button
                                        type="button"
                                        className={groupSetupMode === "join" ? "group-setup-pill active" : "group-setup-pill"}
                                        onClick={() => setGroupSetupMode("join")}
                                    >
                                        Join a group
                                    </button>
                                    <button
                                        type="button"
                                        className={groupSetupMode === "create" ? "group-setup-pill active" : "group-setup-pill"}
                                        onClick={() => setGroupSetupMode("create")}
                                    >
                                        Create a group
                                    </button>
                                </div>

                                {groupSetupMode === "join" ? (
                                    <form onSubmit={(event) => void onJoinGroup(event)} className="compact-form form-stack single-step-form">
                                        <span className="subtle-copy">
                                            {referralJoinCode
                                                ? "Invite link detected. Review the code below or join right away."
                                                : "Enter the code from your group admin"}
                                        </span>
                                        <input
                                            value={joinCode}
                                            onChange={(event) => setJoinCode(event.target.value.toUpperCase())}
                                            placeholder="Join code"
                                            required
                                        />
                                        <button className="primary-button" type="submit" disabled={busyAction === "join-group"}>
                                            Join first group
                                        </button>
                                    </form>
                                ) : (
                                    <form onSubmit={(event) => void onCreateGroup(event)} className="compact-form form-stack single-step-form">
                                        <span className="subtle-copy">Name the first private group</span>
                                        <input
                                            value={groupName}
                                            onChange={(event) => setGroupName(event.target.value)}
                                            placeholder="The Parkers"
                                            required
                                        />
                                        <button className="ghost-button" type="submit" disabled={busyAction === "create-group"}>
                                            Create a new group
                                        </button>
                                    </form>
                                )}

                                <div className="slide-callout">
                                    <span className="preview-label">Group setup</span>
                                    <strong>
                                        {needsFirstGroup
                                            ? "Choose one path for your first group"
                                            : `Connected to ${profile.groups[0]?.name ?? "your first group"}`}
                                    </strong>
                                    <p>Once this is done, you’ll enter a practice market and rehearse the exact flow used on the live board.</p>
                                </div>
                            </div>
                        ) : null}

                        {isPracticeSlide ? (
                            <div className="slideshow-stage tutorial-stage live-tutorial-stage">
                                <div className="tutorial-guide-card">
                                    <span className="preview-label">Live tutorial</span>
                                    <strong>
                                        {tutorialPracticeStep === "done"
                                            ? "Practice run complete"
                                            : "Try the flow on this fake market"}
                                    </strong>
                                    <p>{tutorialPrompt}</p>
                                </div>

                                <article className="market-panel tutorial-market-panel">
                                    <div className="market-topline">
                                        <div>
                                            <p className="kicker">Practice market</p>
                                            <h3>Will the family trip get booked before Friday?</h3>
                                        </div>
                                        <span className="status-pill open">OPEN</span>
                                    </div>

                                    <p className="market-copy">
                                        This is a fake tutorial market. Nothing here touches your real group, payments, or payouts.
                                    </p>

                                    <div className="market-stats">
                                        <div>
                                            <span>YES</span>
                                            <strong>64%</strong>
                                        </div>
                                        <div>
                                            <span>Total pot</span>
                                            <strong>{formatMoney(180)}</strong>
                                        </div>
                                        <div>
                                            <span>Your fake stake</span>
                                            <strong>{tutorialBetPlaced ? formatMoney(tutorialAmountNumber) : formatMoney(0)}</strong>
                                        </div>
                                        <div>
                                            <span>Net if correct</span>
                                            <strong>{tutorialBetPlaced ? formatSignedMoney(tutorialAmountNumber) : formatSignedMoney(0)}</strong>
                                        </div>
                                    </div>

                                    <div className="market-rail">
                                        <div className="market-rail-card">
                                            <span>Creator</span>
                                            <strong>Jamie</strong>
                                        </div>
                                        <div className="market-rail-card">
                                            <span>Venmo to</span>
                                            <strong>
                                                <a className="venmo-link" href={tutorialVenmoUrl} target="_blank" rel="noreferrer">
                                                    @saakethp
                                                </a>
                                            </strong>
                                        </div>
                                        <div className="market-rail-card">
                                            <span>Mode</span>
                                            <strong>Practice only</strong>
                                        </div>
                                    </div>

                                    <div className="trade-box tutorial-trade-box">
                                        <div
                                            className={
                                                tutorialPracticeStep === "pick-side"
                                                    ? "tutorial-focus-ring active"
                                                    : "tutorial-focus-ring"
                                            }
                                            onMouseEnter={() => setTutorialHoverTarget("side")}
                                            onMouseLeave={() => setTutorialHoverTarget(null)}
                                        >
                                            <div className="trade-toggle">
                                                <button
                                                    type="button"
                                                    className={tutorialDraft.side === "YES" ? "toggle-button active-yes" : "toggle-button"}
                                                    onClick={() => onTutorialSideChange("YES")}
                                                >
                                                    YES
                                                </button>
                                                <button
                                                    type="button"
                                                    className={tutorialDraft.side === "NO" ? "toggle-button active-no" : "toggle-button"}
                                                    onClick={() => onTutorialSideChange("NO")}
                                                >
                                                    NO
                                                </button>
                                            </div>
                                        </div>

                                        <div
                                            className={
                                                tutorialPracticeStep === "enter-amount"
                                                    ? "tutorial-focus-ring active"
                                                    : "tutorial-focus-ring"
                                            }
                                            onMouseEnter={() => setTutorialHoverTarget("amount")}
                                            onMouseLeave={() => setTutorialHoverTarget(null)}
                                        >
                                            <input
                                                type="number"
                                                min="0"
                                                value={tutorialDraft.amount}
                                                onChange={(event) => onTutorialAmountChange(event.target.value)}
                                                placeholder="Stake amount"
                                            />
                                        </div>

                                        <div
                                            className={
                                                tutorialPracticeStep === "submit-bet"
                                                    ? "tutorial-focus-ring active"
                                                    : "tutorial-focus-ring"
                                            }
                                            onMouseEnter={() => setTutorialHoverTarget("submit")}
                                            onMouseLeave={() => setTutorialHoverTarget(null)}
                                        >
                                            <button
                                                className="primary-button"
                                                type="button"
                                                disabled={tutorialAmountNumber <= 0 || tutorialBetPlaced}
                                                onClick={onTutorialPlaceBet}
                                            >
                                                {tutorialBetPlaced ? "Fake bet submitted" : "Place practice bet"}
                                            </button>
                                        </div>

                                        <p className="trade-note">
                                            After saving, send {formatMoney(tutorialAmountNumber || 0)} to{" "}
                                            <a className="venmo-link" href={tutorialVenmoUrl} target="_blank" rel="noreferrer">
                                                @saakethp
                                            </a>{" "}
                                            so the market creator can escrow the pool.
                                        </p>

                                        {tutorialBetPlaced ? (
                                            <div
                                                className={
                                                    tutorialPracticeStep === "send-venmo"
                                                        ? "settlement-box tutorial-focus-ring active"
                                                        : "settlement-box tutorial-focus-ring"
                                                }
                                                onMouseEnter={() => setTutorialHoverTarget("payment")}
                                                onMouseLeave={() => setTutorialHoverTarget(null)}
                                            >
                                                <div className="settlement-heading">
                                                    <span className="kicker">Pending tutorial receipt</span>
                                                    <strong>Fake payment confirmation</strong>
                                                </div>
                                                <p className="trade-note pending-note">
                                                    Practice pending: {tutorialDraft.side} for {formatMoney(tutorialAmountNumber)}. In the real app, this stays pending until the creator confirms they got your Venmo.
                                                </p>
                                                <button
                                                    className="secondary-button tutorial-payment-button"
                                                    type="button"
                                                    disabled={tutorialPracticeStep === "done"}
                                                    onClick={onTutorialPaymentSent}
                                                >
                                                    {tutorialPracticeStep === "done"
                                                        ? "Practice payment confirmed"
                                                        : "I sent the practice Venmo"}
                                                </button>
                                            </div>
                                        ) : null}
                                    </div>
                                </article>

                                {tutorialPracticeStep === "done" ? (
                                    <div className="tutorial-success-banner">
                                        <strong>You’ve completed the fake bet flow.</strong>
                                        <p>The live board uses the same steps: choose a side, enter an amount, save the position, then follow the payment confirmation prompt.</p>
                                    </div>
                                ) : null}
                            </div>
                        ) : null}

                        <div className="onboarding-footer slideshow-controls">
                            <button
                                className="ghost-button"
                                type="button"
                                disabled={onboardingStep === 0}
                                onClick={() => setOnboardingStep((current) => Math.max(0, current - 1))}
                            >
                                Previous
                            </button>

                            {onboardingStep < TOTAL_ONBOARDING_STEPS - 1 ? (
                                <button
                                    className="primary-button"
                                    type="button"
                                    disabled={
                                        (isVenmoSlide && needsVenmoHandle) ||
                                        (isGroupSlide && needsFirstGroup) ||
                                        (isPracticeSlide && !canStartPractice)
                                    }
                                    onClick={() => setOnboardingStep((current) => Math.min(TOTAL_ONBOARDING_STEPS - 1, current + 1))}
                                >
                                    {isIntroSlide ? "Start tutorial" : isGroupSlide ? "Open live tutorial" : "Next"}
                                </button>
                            ) : (
                                <button
                                    className="primary-button"
                                    type="button"
                                    disabled={!onboardingReady || tutorialPracticeStep !== "done" || busyAction === "tutorial-complete"}
                                    onClick={() => void onCompleteTutorial()}
                                >
                                    Continue to dashboard
                                </button>
                            )}
                        </div>
                    </article>
                </section>
            </section>
        </main>
    );
}
