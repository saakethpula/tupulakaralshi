import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
import { useEffect, useMemo, useState } from "react";
import { useAuth0 } from "@auth0/auth0-react";
import { confirmPosition, createGroup, createMarket, deleteMarket, getCurrentUser, getMarkets, joinGroup, markPayoutSent, rejectPosition, respondToPayout, resolveMarket, updateVenmoHandle, upsertPosition } from "./lib/api";
const DEFAULT_TRADE_AMOUNT = "5";
const GENERAL_MARKET_VALUE = "GENERAL";
const ONBOARDING_STORAGE_PREFIX = "first-steps-complete:";
const ONBOARDING_COOKIE_PREFIX = "first_steps_complete_";
const ONBOARDING_COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 365;
const REFERRAL_PARAM_KEYS = ["groupCode", "joinCode", "code"];
const AUTO_REFRESH_INTERVAL_MS = 2000;
function tomorrowAtNoon() {
    const date = new Date();
    date.setDate(date.getDate() + 1);
    date.setHours(12, 0, 0, 0);
    return date.toISOString().slice(0, 16);
}
function formatMoney(amount) {
    return new Intl.NumberFormat("en-US", {
        style: "currency",
        currency: "USD",
        maximumFractionDigits: 0
    }).format(amount);
}
function formatSignedMoney(amount) {
    if (amount === 0) {
        return formatMoney(0);
    }
    return `${amount > 0 ? "+" : "-"}${formatMoney(Math.abs(amount))}`;
}
function normalizeVenmoHandle(handle) {
    return (handle ?? "").replace(/^@+/, "").trim();
}
function getVenmoUrl(handle) {
    const normalizedHandle = normalizeVenmoHandle(handle);
    return normalizedHandle ? `https://venmo.com/u/${normalizedHandle}` : "";
}
function getReferralJoinCodeFromUrl() {
    if (typeof window === "undefined") {
        return "";
    }
    const searchParams = new URLSearchParams(window.location.search);
    for (const key of REFERRAL_PARAM_KEYS) {
        const value = searchParams.get(key)?.trim();
        if (value) {
            return value.toUpperCase();
        }
    }
    return "";
}
function clearReferralJoinCodeFromUrl() {
    if (typeof window === "undefined") {
        return;
    }
    const nextUrl = new URL(window.location.href);
    for (const key of REFERRAL_PARAM_KEYS) {
        nextUrl.searchParams.delete(key);
    }
    window.history.replaceState({}, "", `${nextUrl.pathname}${nextUrl.search}${nextUrl.hash}`);
}
function buildGroupInviteUrl(joinCode) {
    if (typeof window === "undefined") {
        return "";
    }
    const inviteUrl = new URL(window.location.origin + window.location.pathname);
    inviteUrl.searchParams.set("groupCode", joinCode);
    return inviteUrl.toString();
}
function getOnboardingStorageKey(userId) {
    return `${ONBOARDING_STORAGE_PREFIX}${userId}`;
}
function getOnboardingCookieName(userId) {
    return `${ONBOARDING_COOKIE_PREFIX}${userId}`;
}
function readCookie(name) {
    if (typeof document === "undefined") {
        return "";
    }
    const cookiePrefix = `${name}=`;
    const cookie = document.cookie
        .split(";")
        .map((part) => part.trim())
        .find((part) => part.startsWith(cookiePrefix));
    return cookie ? decodeURIComponent(cookie.slice(cookiePrefix.length)) : "";
}
function hasCompletedOnboarding(userId) {
    const onboardingStorageKey = getOnboardingStorageKey(userId);
    const onboardingCookieName = getOnboardingCookieName(userId);
    try {
        if (window.localStorage.getItem(onboardingStorageKey) === "true") {
            return true;
        }
    }
    catch {
        // Fall back to the cookie copy when localStorage is unavailable or corrupted.
    }
    return readCookie(onboardingCookieName) === "true";
}
function persistOnboardingCompletion(userId) {
    const onboardingStorageKey = getOnboardingStorageKey(userId);
    const onboardingCookieName = getOnboardingCookieName(userId);
    try {
        window.localStorage.setItem(onboardingStorageKey, "true");
    }
    catch {
        // Cookie persistence still keeps onboarding complete if localStorage is unavailable.
    }
    document.cookie = `${onboardingCookieName}=true; Max-Age=${ONBOARDING_COOKIE_MAX_AGE_SECONDS}; Path=/; SameSite=Lax`;
}
export default function App() {
    const { isAuthenticated, isLoading, loginWithRedirect, logout, user, getAccessTokenSilently } = useAuth0();
    const [token, setToken] = useState("");
    const [profile, setProfile] = useState(null);
    const [selectedGroupId, setSelectedGroupId] = useState("");
    const [markets, setMarkets] = useState([]);
    const [tradeDrafts, setTradeDrafts] = useState({});
    const [groupName, setGroupName] = useState("");
    const [joinCode, setJoinCode] = useState("");
    const [referralJoinCode, setReferralJoinCode] = useState(() => getReferralJoinCodeFromUrl());
    const [hasAttemptedReferralJoin, setHasAttemptedReferralJoin] = useState(false);
    const [venmoHandle, setVenmoHandle] = useState("");
    const [question, setQuestion] = useState("");
    const [description, setDescription] = useState("");
    const [targetUserId, setTargetUserId] = useState("");
    const [closesAt, setClosesAt] = useState(tomorrowAtNoon());
    const [statusMessage, setStatusMessage] = useState("Sign in to launch your prediction desk.");
    const [error, setError] = useState("");
    const [busyAction, setBusyAction] = useState("");
    const [settingsOpen, setSettingsOpen] = useState(false);
    const [showOnboarding, setShowOnboarding] = useState(false);
    const [onboardingStep, setOnboardingStep] = useState(0);
    const [groupSetupMode, setGroupSetupMode] = useState("join");
    const [tutorialDraft, setTutorialDraft] = useState({ side: "YES", amount: DEFAULT_TRADE_AMOUNT });
    const [tutorialPracticeStep, setTutorialPracticeStep] = useState("pick-side");
    const [tutorialHoverTarget, setTutorialHoverTarget] = useState(null);
    const [tutorialBetPlaced, setTutorialBetPlaced] = useState(false);
    const selectedGroup = useMemo(() => profile?.groups.find((group) => group.id === selectedGroupId) ?? null, [profile, selectedGroupId]);
    const visibleMembers = useMemo(() => [...(selectedGroup?.members ?? [])].sort((left, right) => right.balance - left.balance), [selectedGroup]);
    const needsVenmoHandle = !profile?.user.venmoHandle;
    const needsFirstGroup = (profile?.groups.length ?? 0) === 0;
    const onboardingReady = !needsVenmoHandle && !needsFirstGroup;
    const canStartPractice = onboardingReady;
    const totalOnboardingSteps = 4;
    const isIntroSlide = onboardingStep === 0;
    const isVenmoSlide = onboardingStep === 1;
    const isGroupSlide = onboardingStep === 2;
    const isPracticeSlide = onboardingStep === 3;
    const tutorialAmountNumber = Number(tutorialDraft.amount || "0");
    const tutorialVenmoUrl = getVenmoUrl("saakethp");
    const selectedGroupInviteUrl = selectedGroup ? buildGroupInviteUrl(selectedGroup.joinCode) : "";
    const tutorialPrompt = tutorialHoverTarget === "side"
        ? "Pick the side you want to back. This mirrors the real YES / NO toggle in the live app."
        : tutorialHoverTarget === "amount"
            ? "Enter a fake stake here. Nothing in this tutorial moves real money or changes the market."
            : tutorialHoverTarget === "submit"
                ? "This is the same action you’ll use later on the real market board to save your position."
                : tutorialHoverTarget === "payment"
                    ? "After saving a real position, the app tells you who to Venmo and waits for payment confirmation."
                    : tutorialPracticeStep === "pick-side"
                        ? "Step 1: choose YES or NO on this fake market to start the tutorial bet."
                        : tutorialPracticeStep === "enter-amount"
                            ? "Step 2: type the amount you want to stake. Try something like 5."
                            : tutorialPracticeStep === "submit-bet"
                                ? "Step 3: submit the fake bet so you can see the payment instructions."
                                : tutorialPracticeStep === "send-venmo"
                                    ? "Step 4: simulate sending the Venmo so you can see how a pending confirmation works."
                                    : "Tutorial complete. You’ve walked through the full fake bet flow and can open the real dashboard.";
    async function refreshProfile(accessToken) {
        const nextProfile = await getCurrentUser(accessToken);
        setProfile(nextProfile);
        setVenmoHandle(nextProfile.user.venmoHandle ?? "");
        return nextProfile;
    }
    async function refreshMarkets(accessToken, groupId) {
        const nextMarkets = await getMarkets(accessToken, groupId);
        setMarkets(nextMarkets);
        setTradeDrafts((currentDrafts) => {
            const nextDrafts = { ...currentDrafts };
            for (const market of nextMarkets) {
                if (!nextDrafts[market.id]) {
                    nextDrafts[market.id] = {
                        side: market.userPosition.noAmount > market.userPosition.yesAmount ? "NO" : "YES",
                        amount: market.userPosition.totalAmount > 0
                            ? String(market.userPosition.totalAmount)
                            : DEFAULT_TRADE_AMOUNT
                    };
                }
            }
            return nextDrafts;
        });
    }
    async function refreshWorkspace(accessToken, groupId) {
        await Promise.all([refreshProfile(accessToken), refreshMarkets(accessToken, groupId)]);
    }
    async function copyInviteLink(joinCodeToShare) {
        const inviteUrl = buildGroupInviteUrl(joinCodeToShare);
        if (!inviteUrl) {
            return;
        }
        try {
            await navigator.clipboard.writeText(inviteUrl);
            setStatusMessage("Invite link copied.");
            setError("");
        }
        catch (requestError) {
            setError(requestError instanceof Error ? requestError.message : "Failed to copy invite link.");
        }
    }
    useEffect(() => {
        if (!isAuthenticated) {
            return;
        }
        let active = true;
        void (async () => {
            try {
                const accessToken = await getAccessTokenSilently();
                if (!active) {
                    return;
                }
                setToken(accessToken);
                const nextProfile = await refreshProfile(accessToken);
                const initialGroupId = nextProfile.groups[0]?.id ?? "";
                setSelectedGroupId(initialGroupId);
                if (initialGroupId) {
                    await refreshMarkets(accessToken, initialGroupId);
                }
            }
            catch (requestError) {
                if (!active) {
                    return;
                }
                setError(requestError instanceof Error ? requestError.message : "Failed to load app data.");
            }
        })();
        return () => {
            active = false;
        };
    }, [getAccessTokenSilently, isAuthenticated]);
    useEffect(() => {
        if (!token || !selectedGroupId) {
            return;
        }
        void refreshMarkets(token, selectedGroupId).catch((requestError) => {
            setError(requestError instanceof Error ? requestError.message : "Failed to load markets.");
        });
    }, [selectedGroupId, token]);
    useEffect(() => {
        if (!token) {
            return;
        }
        let active = true;
        let refreshing = false;
        const refreshLiveData = async () => {
            if (!active || refreshing || document.visibilityState === "hidden") {
                return;
            }
            refreshing = true;
            try {
                const nextProfile = await refreshProfile(token);
                if (!active) {
                    return;
                }
                if (!selectedGroupId && nextProfile.groups[0]?.id) {
                    setSelectedGroupId(nextProfile.groups[0].id);
                }
                else if (selectedGroupId && !nextProfile.groups.some((group) => group.id === selectedGroupId)) {
                    setSelectedGroupId(nextProfile.groups[0]?.id ?? "");
                }
                if (selectedGroupId) {
                    await refreshMarkets(token, selectedGroupId);
                }
                setError("");
            }
            catch (requestError) {
                if (!active) {
                    return;
                }
                setError(requestError instanceof Error ? requestError.message : "Failed to refresh live data.");
            }
            finally {
                refreshing = false;
            }
        };
        const intervalId = window.setInterval(() => {
            void refreshLiveData();
        }, AUTO_REFRESH_INTERVAL_MS);
        return () => {
            active = false;
            window.clearInterval(intervalId);
        };
    }, [selectedGroupId, token]);
    useEffect(() => {
        if (!profile) {
            return;
        }
        const onboardingComplete = hasCompletedOnboarding(profile.user.id);
        if (!onboardingComplete) {
            setShowOnboarding(true);
            return;
        }
        setShowOnboarding(false);
    }, [profile]);
    useEffect(() => {
        if (!referralJoinCode) {
            return;
        }
        setJoinCode(referralJoinCode);
        setGroupSetupMode("join");
    }, [referralJoinCode]);
    useEffect(() => {
        if (!token || !profile || !referralJoinCode || hasAttemptedReferralJoin) {
            return;
        }
        const existingGroup = profile.groups.find((group) => group.joinCode === referralJoinCode);
        if (existingGroup) {
            setSelectedGroupId(existingGroup.id);
            setReferralJoinCode("");
            clearReferralJoinCodeFromUrl();
            setStatusMessage(`Invite link opened for ${existingGroup.name}.`);
            return;
        }
        setHasAttemptedReferralJoin(true);
        setBusyAction("join-group");
        setError("");
        void (async () => {
            try {
                const response = await joinGroup(token, referralJoinCode);
                setSelectedGroupId(response.groupId);
                setJoinCode("");
                setReferralJoinCode("");
                clearReferralJoinCodeFromUrl();
                await refreshWorkspace(token, response.groupId);
                setStatusMessage("Joined the group from the invite link.");
            }
            catch (requestError) {
                setError(requestError instanceof Error ? requestError.message : "Failed to join group.");
            }
            finally {
                setBusyAction("");
            }
        })();
    }, [hasAttemptedReferralJoin, profile, referralJoinCode, token]);
    useEffect(() => {
        if (onboardingStep === 1 && !needsVenmoHandle) {
            setOnboardingStep(2);
        }
    }, [needsVenmoHandle, onboardingStep]);
    useEffect(() => {
        if (onboardingStep === 2 && !needsFirstGroup) {
            setOnboardingStep(3);
        }
    }, [needsFirstGroup, onboardingStep]);
    useEffect(() => {
        if (tutorialPracticeStep === "enter-amount" && tutorialAmountNumber > 0) {
            setTutorialPracticeStep("submit-bet");
        }
    }, [tutorialAmountNumber, tutorialPracticeStep]);
    function updateTradeDraft(marketId, patch) {
        setTradeDrafts((currentDrafts) => ({
            ...currentDrafts,
            [marketId]: {
                side: currentDrafts[marketId]?.side ?? "YES",
                amount: currentDrafts[marketId]?.amount ?? DEFAULT_TRADE_AMOUNT,
                ...patch
            }
        }));
    }
    function handleTutorialSideChange(side) {
        setTutorialDraft((current) => ({
            ...current,
            side
        }));
        if (tutorialPracticeStep === "pick-side") {
            setTutorialPracticeStep("enter-amount");
        }
    }
    function handleTutorialAmountChange(amount) {
        setTutorialDraft((current) => ({
            ...current,
            amount
        }));
    }
    function handleTutorialPlaceBet() {
        if (tutorialAmountNumber <= 0) {
            return;
        }
        setTutorialBetPlaced(true);
        setTutorialPracticeStep("send-venmo");
    }
    function handleTutorialPaymentSent() {
        setTutorialPracticeStep("done");
    }
    async function handleCreateGroup(event) {
        event.preventDefault();
        setError("");
        setBusyAction("create-group");
        try {
            const group = await createGroup(token, groupName);
            setSelectedGroupId(group.id);
            setGroupName("");
            await refreshWorkspace(token, group.id);
            setStatusMessage(`Created ${group.name}.`);
        }
        catch (requestError) {
            setError(requestError instanceof Error ? requestError.message : "Failed to create group.");
        }
        finally {
            setBusyAction("");
        }
    }
    async function handleJoinGroup(event) {
        event.preventDefault();
        setError("");
        setBusyAction("join-group");
        try {
            const response = await joinGroup(token, joinCode);
            setSelectedGroupId(response.groupId);
            setJoinCode("");
            setReferralJoinCode("");
            clearReferralJoinCodeFromUrl();
            await refreshWorkspace(token, response.groupId);
            setStatusMessage("Joined the group.");
        }
        catch (requestError) {
            setError(requestError instanceof Error ? requestError.message : "Failed to join group.");
        }
        finally {
            setBusyAction("");
        }
    }
    async function handleSaveVenmoHandle(event) {
        event.preventDefault();
        setError("");
        setBusyAction("venmo");
        try {
            await updateVenmoHandle(token, venmoHandle);
            await refreshProfile(token);
            setStatusMessage(`Venmo handle saved as @${normalizeVenmoHandle(venmoHandle)}.`);
        }
        catch (requestError) {
            setError(requestError instanceof Error ? requestError.message : "Failed to save Venmo handle.");
        }
        finally {
            setBusyAction("");
        }
    }
    async function handleCreateMarket(event) {
        event.preventDefault();
        setError("");
        setBusyAction("create-market");
        try {
            await createMarket(token, {
                groupId: selectedGroupId,
                targetUserId: targetUserId === GENERAL_MARKET_VALUE ? null : targetUserId,
                question,
                description,
                closesAt: new Date(closesAt).toISOString()
            });
            await refreshMarkets(token, selectedGroupId);
            setQuestion("");
            setDescription("");
            setTargetUserId("");
            setClosesAt(tomorrowAtNoon());
            setStatusMessage("Market published.");
        }
        catch (requestError) {
            setError(requestError instanceof Error ? requestError.message : "Failed to create market.");
        }
        finally {
            setBusyAction("");
        }
    }
    async function handleSavePosition(marketId) {
        const draft = tradeDrafts[marketId] ?? { side: "YES", amount: DEFAULT_TRADE_AMOUNT };
        setError("");
        setBusyAction(`position-${marketId}`);
        try {
            const updatedMarket = await upsertPosition(token, marketId, {
                side: draft.side,
                amount: Number(draft.amount || "0")
            });
            await refreshWorkspace(token, selectedGroupId);
            setStatusMessage(Number(draft.amount || "0") > 0
                ? `Position submitted. Send ${formatMoney(Number(draft.amount || "0"))} using the Venmo link for ${updatedMarket.venmoRecipient.venmoHandle ? `@${normalizeVenmoHandle(updatedMarket.venmoRecipient.venmoHandle)}` : updatedMarket.venmoRecipient.displayName}, then wait for creator confirmation.`
                : "Position removed.");
        }
        catch (requestError) {
            setError(requestError instanceof Error ? requestError.message : "Failed to save position.");
        }
        finally {
            setBusyAction("");
        }
    }
    async function handleConfirmPosition(marketId, positionId) {
        setError("");
        setBusyAction(`confirm-${positionId}`);
        try {
            await confirmPosition(token, marketId, positionId);
            await refreshWorkspace(token, selectedGroupId);
            setStatusMessage("Payment confirmed. The position is now live on the market.");
        }
        catch (requestError) {
            setError(requestError instanceof Error ? requestError.message : "Failed to confirm payment.");
        }
        finally {
            setBusyAction("");
        }
    }
    async function handleRejectPosition(marketId, positionId) {
        setError("");
        setBusyAction(`reject-${positionId}`);
        try {
            await rejectPosition(token, marketId, positionId);
            await refreshWorkspace(token, selectedGroupId);
            setStatusMessage("Pending position rejected.");
        }
        catch (requestError) {
            setError(requestError instanceof Error ? requestError.message : "Failed to reject payment.");
        }
        finally {
            setBusyAction("");
        }
    }
    async function handleResolve(marketId, resolution) {
        setError("");
        setBusyAction(`resolve-${marketId}`);
        try {
            await resolveMarket(token, marketId, resolution);
            await refreshWorkspace(token, selectedGroupId);
            setStatusMessage("Market resolved and win/loss totals updated.");
        }
        catch (requestError) {
            setError(requestError instanceof Error ? requestError.message : "Failed to resolve market.");
        }
        finally {
            setBusyAction("");
        }
    }
    async function handleDeleteMarket(marketId) {
        setError("");
        setBusyAction(`delete-${marketId}`);
        try {
            await deleteMarket(token, marketId);
            await refreshWorkspace(token, selectedGroupId);
            setStatusMessage("Market removed and all positions refunded.");
        }
        catch (requestError) {
            setError(requestError instanceof Error ? requestError.message : "Failed to remove market.");
        }
        finally {
            setBusyAction("");
        }
    }
    async function handleMarkPayoutSent(marketId, payoutId) {
        setError("");
        setBusyAction(`payout-sent-${payoutId}`);
        try {
            await markPayoutSent(token, marketId, payoutId);
            await refreshWorkspace(token, selectedGroupId);
            setStatusMessage("Payout marked as sent. The winner will now be asked to confirm receipt.");
        }
        catch (requestError) {
            setError(requestError instanceof Error ? requestError.message : "Failed to mark payout as sent.");
        }
        finally {
            setBusyAction("");
        }
    }
    async function handleRespondToPayout(marketId, payoutId, received) {
        setError("");
        setBusyAction(`payout-response-${payoutId}`);
        try {
            await respondToPayout(token, marketId, payoutId, received);
            await refreshWorkspace(token, selectedGroupId);
            setStatusMessage(received
                ? "Payout confirmed. Once every winner confirms, this market will disappear from the board."
                : "Payout dispute sent back to the creator. They need to send payment again.");
        }
        catch (requestError) {
            setError(requestError instanceof Error ? requestError.message : "Failed to respond to payout confirmation.");
        }
        finally {
            setBusyAction("");
        }
    }
    if (isLoading) {
        return _jsx("main", { className: "shell", children: _jsx("section", { className: "loading-panel", children: "Loading authentication..." }) });
    }
    if (!isAuthenticated) {
        return (_jsx("main", { className: "shell landing-shell", children: _jsxs("section", { className: "landing-hero", children: [_jsxs("div", { className: "hero-copy", children: [_jsx("p", { className: "kicker", children: "Family Prediction Market" }), _jsx("h1", { children: "Private forecasting with sharper stakes and cleaner secrets." }), _jsx("p", { className: "hero-lede", children: "Spin up hidden markets, track family predictions, and settle results automatically in a dashboard that feels more like a modern trading desk than a school project." }), _jsxs("div", { className: "hero-actions", children: [_jsx("button", { className: "primary-button", onClick: () => void loginWithRedirect({
                                            appState: {
                                                returnTo: `${window.location.pathname}${window.location.search}${window.location.hash}`
                                            }
                                        }), children: "Enter the market" }), _jsx("div", { className: "hero-note", children: "Hidden from the subject, visible to the family, settled through real payment tracking." })] })] }), _jsxs("div", { className: "hero-preview", children: [_jsxs("div", { className: "preview-card", children: [_jsx("span", { className: "preview-label", children: "Live signal" }), _jsx("strong", { children: "72% YES" }), _jsx("p", { children: "Will Jordan finally announce the move before July?" })] }), _jsxs("div", { className: "preview-card", children: [_jsx("span", { className: "preview-label", children: "Win / loss tracker" }), _jsxs("strong", { children: ["+", formatMoney(1240)] }), _jsx("p", { children: "Track how much each person is up or down after markets resolve." })] })] })] }) }));
    }
    if (!profile) {
        return (_jsx("main", { className: "shell", children: _jsx("section", { className: "loading-panel", children: "Loading your workspace..." }) }));
    }
    if (showOnboarding) {
        const progressCount = onboardingStep + 1;
        const progressPercent = (progressCount / totalOnboardingSteps) * 100;
        return (_jsx("main", { className: "shell app-shell", children: _jsxs("section", { className: "onboarding-shell", children: [_jsxs("article", { className: "onboarding-hero", children: [_jsxs("div", { className: "hero-copy", children: [_jsx("p", { className: "kicker onboarding-kicker", children: "Interactive tutorial" }), _jsx("h1", { children: "Learn the flow before you touch the live board." }), _jsx("p", { className: "hero-lede", children: "First we connect your payment handle, then we get you into a group, then we walk through one complete practice market so the live dashboard feels obvious." })] }), _jsxs("div", { className: "onboarding-progress", children: [_jsxs("div", { className: onboardingStep === 0 ? "progress-card active" : "progress-card complete", children: [_jsx("span", { className: "preview-label", children: "Start" }), _jsx("strong", { children: "Tutorial overview" }), _jsx("p", { children: "A quick preview of the setup and practice flow before you enter the real app." })] }), _jsxs("div", { className: onboardingStep === 1
                                            ? "progress-card active"
                                            : needsVenmoHandle
                                                ? "progress-card"
                                                : "progress-card complete", children: [_jsx("span", { className: "preview-label", children: "Step 1" }), _jsx("strong", { children: needsVenmoHandle ? "Add your Venmo" : "Venmo linked" }), _jsx("p", { children: needsVenmoHandle
                                                    ? "Save the handle people should use when paying or settling with you."
                                                    : `Payments can now be routed to @${profile.user.venmoHandle}.` })] }), _jsxs("div", { className: onboardingStep === 2
                                            ? "progress-card active"
                                            : needsFirstGroup
                                                ? "progress-card"
                                                : "progress-card complete", children: [_jsx("span", { className: "preview-label", children: "Step 2" }), _jsx("strong", { children: needsFirstGroup ? "Join or create a group" : "Group connected" }), _jsx("p", { children: needsFirstGroup
                                                    ? "Choose one path on a dedicated screen instead of juggling both forms at once."
                                                    : `You’re connected to ${profile.groups[0]?.name ?? "your first group"}.` })] }), _jsxs("div", { className: isPracticeSlide
                                            ? "progress-card active"
                                            : canStartPractice
                                                ? "progress-card complete"
                                                : "progress-card", children: [_jsx("span", { className: "preview-label", children: "Step 3" }), _jsx("strong", { children: canStartPractice ? "Live tutorial" : "Finish setup to unlock tutorial" }), _jsx("p", { children: "Practice a fake bet, see the payment-confirmation flow, and then unlock the real dashboard." })] })] })] }), _jsxs("section", { className: "status-banner", children: [_jsx("span", { children: statusMessage }), error ? _jsx("strong", { children: error }) : null] }), _jsx("section", { className: "onboarding-grid", children: _jsxs("article", { className: "panel onboarding-slide-panel", children: [_jsxs("div", { className: "panel-heading onboarding-slide-heading", children: [_jsxs("div", { children: [_jsx("p", { className: "kicker", children: isIntroSlide
                                                        ? "Tutorial cover"
                                                        : isVenmoSlide
                                                            ? "Step 1 of 3"
                                                            : isGroupSlide
                                                                ? "Step 2 of 3"
                                                                : "Live practice" }), _jsx("h2", { children: isIntroSlide
                                                        ? "Before you enter the dashboard"
                                                        : isVenmoSlide
                                                            ? "Add the Venmo handle people should pay"
                                                            : isGroupSlide
                                                                ? "Join a group or create your first one"
                                                                : "Try a fake market before using the real app" })] }), _jsxs("span", { className: "subtle-copy", children: ["Screen ", progressCount, " of ", totalOnboardingSteps] })] }), isIntroSlide ? (_jsxs("div", { className: "slideshow-stage tutorial-cover", children: [_jsx("div", { className: "cover-badge", children: "Interactive walkthrough" }), _jsx("p", { className: "cover-title", children: "We\u2019ll set up your account, then rehearse the real flow one step at a time." }), _jsx("p", { className: "cover-copy", children: "Each screen has one job. Save your payment handle, join or create a group, then place one practice position so the live board already feels familiar." }), _jsxs("div", { className: "cover-highlights", children: [_jsxs("div", { className: "cover-highlight", children: [_jsx("strong", { children: "1. Save Venmo" }), _jsx("p", { children: "Make sure everyone knows where to send money for market payments and settlement." })] }), _jsxs("div", { className: "cover-highlight", children: [_jsx("strong", { children: "2. Pick your group path" }), _jsx("p", { children: "Use one full screen to either join an existing group or start a new one yourself." })] }), _jsxs("div", { className: "cover-highlight", children: [_jsx("strong", { children: "3. Learn the flow" }), _jsx("p", { children: "Place a fake bet, see the fake Venmo step, and unlock the real dashboard after you practice." })] })] })] })) : null, isVenmoSlide ? (_jsxs("div", { className: "slideshow-stage", children: [_jsxs("div", { className: "slide-callout", children: [_jsx("span", { className: "preview-label", children: "Payout setup" }), _jsx("strong", { children: needsVenmoHandle ? "Add your handle to continue" : `Saved as @${profile.user.venmoHandle}` }), _jsx("p", { children: "This step gets payment instructions right anywhere the app asks people to fund or settle a position." })] }), _jsxs("form", { onSubmit: handleSaveVenmoHandle, className: "compact-form form-stack single-step-form", children: [_jsx("span", { className: "subtle-copy", children: "Where should people Venmo you?" }), _jsx("input", { value: venmoHandle, onChange: (event) => setVenmoHandle(event.target.value), placeholder: "@yourhandle", required: true }), _jsx("button", { className: "secondary-button", type: "submit", disabled: busyAction === "venmo", children: needsVenmoHandle ? "Save Venmo handle" : "Update Venmo handle" })] })] })) : null, isGroupSlide ? (_jsxs("div", { className: "slideshow-stage", children: [_jsxs("div", { className: "group-setup-switcher", children: [_jsx("button", { type: "button", className: groupSetupMode === "join" ? "group-setup-pill active" : "group-setup-pill", onClick: () => setGroupSetupMode("join"), children: "Join a group" }), _jsx("button", { type: "button", className: groupSetupMode === "create" ? "group-setup-pill active" : "group-setup-pill", onClick: () => setGroupSetupMode("create"), children: "Create a group" })] }), groupSetupMode === "join" ? (_jsxs("form", { onSubmit: handleJoinGroup, className: "compact-form form-stack single-step-form", children: [_jsx("span", { className: "subtle-copy", children: referralJoinCode
                                                        ? "Invite link detected. Review the code below or join right away."
                                                        : "Enter the code from your group admin" }), _jsx("input", { value: joinCode, onChange: (event) => setJoinCode(event.target.value.toUpperCase()), placeholder: "Join code", required: true }), _jsx("button", { className: "primary-button", type: "submit", disabled: busyAction === "join-group", children: "Join first group" })] })) : (_jsxs("form", { onSubmit: handleCreateGroup, className: "compact-form form-stack single-step-form", children: [_jsx("span", { className: "subtle-copy", children: "Name the first private group" }), _jsx("input", { value: groupName, onChange: (event) => setGroupName(event.target.value), placeholder: "The Parkers", required: true }), _jsx("button", { className: "ghost-button", type: "submit", disabled: busyAction === "create-group", children: "Create a new group" })] })), _jsxs("div", { className: "slide-callout", children: [_jsx("span", { className: "preview-label", children: "Group setup" }), _jsx("strong", { children: needsFirstGroup
                                                        ? "Choose one path for your first group"
                                                        : `Connected to ${profile.groups[0]?.name ?? "your first group"}` }), _jsx("p", { children: "Once this is done, you\u2019ll enter a practice market and rehearse the exact flow used on the live board." })] })] })) : null, isPracticeSlide ? (_jsxs("div", { className: "slideshow-stage tutorial-stage live-tutorial-stage", children: [_jsxs("div", { className: "tutorial-guide-card", children: [_jsx("span", { className: "preview-label", children: "Live tutorial" }), _jsx("strong", { children: tutorialPracticeStep === "done"
                                                        ? "Practice run complete"
                                                        : "Try the flow on this fake market" }), _jsx("p", { children: tutorialPrompt })] }), _jsxs("article", { className: "market-panel tutorial-market-panel", children: [_jsxs("div", { className: "market-topline", children: [_jsxs("div", { children: [_jsx("p", { className: "kicker", children: "Practice market" }), _jsx("h3", { children: "Will the family trip get booked before Friday?" })] }), _jsx("span", { className: "status-pill open", children: "OPEN" })] }), _jsx("p", { className: "market-copy", children: "This is a fake tutorial market. Nothing here touches your real group, payments, or payouts." }), _jsxs("div", { className: "market-stats", children: [_jsxs("div", { children: [_jsx("span", { children: "YES" }), _jsx("strong", { children: "64%" })] }), _jsxs("div", { children: [_jsx("span", { children: "Total pot" }), _jsx("strong", { children: formatMoney(180) })] }), _jsxs("div", { children: [_jsx("span", { children: "Your fake stake" }), _jsx("strong", { children: tutorialBetPlaced ? formatMoney(tutorialAmountNumber) : formatMoney(0) })] }), _jsxs("div", { children: [_jsx("span", { children: "Net if correct" }), _jsx("strong", { children: tutorialBetPlaced ? formatSignedMoney(tutorialAmountNumber) : formatSignedMoney(0) })] })] }), _jsxs("div", { className: "market-rail", children: [_jsxs("div", { className: "market-rail-card", children: [_jsx("span", { children: "Creator" }), _jsx("strong", { children: "Jamie" })] }), _jsxs("div", { className: "market-rail-card", children: [_jsx("span", { children: "Venmo to" }), _jsx("strong", { children: _jsx("a", { className: "venmo-link", href: tutorialVenmoUrl, target: "_blank", rel: "noreferrer", children: "@saakethp" }) })] }), _jsxs("div", { className: "market-rail-card", children: [_jsx("span", { children: "Mode" }), _jsx("strong", { children: "Practice only" })] })] }), _jsxs("div", { className: "trade-box tutorial-trade-box", children: [_jsx("div", { className: tutorialPracticeStep === "pick-side"
                                                                ? "tutorial-focus-ring active"
                                                                : "tutorial-focus-ring", onMouseEnter: () => setTutorialHoverTarget("side"), onMouseLeave: () => setTutorialHoverTarget(null), children: _jsxs("div", { className: "trade-toggle", children: [_jsx("button", { type: "button", className: tutorialDraft.side === "YES" ? "toggle-button active-yes" : "toggle-button", onClick: () => handleTutorialSideChange("YES"), children: "YES" }), _jsx("button", { type: "button", className: tutorialDraft.side === "NO" ? "toggle-button active-no" : "toggle-button", onClick: () => handleTutorialSideChange("NO"), children: "NO" })] }) }), _jsx("div", { className: tutorialPracticeStep === "enter-amount"
                                                                ? "tutorial-focus-ring active"
                                                                : "tutorial-focus-ring", onMouseEnter: () => setTutorialHoverTarget("amount"), onMouseLeave: () => setTutorialHoverTarget(null), children: _jsx("input", { type: "number", min: "0", value: tutorialDraft.amount, onChange: (event) => handleTutorialAmountChange(event.target.value), placeholder: "Stake amount" }) }), _jsx("div", { className: tutorialPracticeStep === "submit-bet"
                                                                ? "tutorial-focus-ring active"
                                                                : "tutorial-focus-ring", onMouseEnter: () => setTutorialHoverTarget("submit"), onMouseLeave: () => setTutorialHoverTarget(null), children: _jsx("button", { className: "primary-button", type: "button", disabled: tutorialAmountNumber <= 0 || tutorialBetPlaced, onClick: handleTutorialPlaceBet, children: tutorialBetPlaced ? "Fake bet submitted" : "Place practice bet" }) }), _jsxs("p", { className: "trade-note", children: ["After saving, send ", formatMoney(tutorialAmountNumber || 0), " to", " ", _jsx("a", { className: "venmo-link", href: tutorialVenmoUrl, target: "_blank", rel: "noreferrer", children: "@saakethp" }), " ", "so the market creator can escrow the pool."] }), tutorialBetPlaced ? (_jsxs("div", { className: tutorialPracticeStep === "send-venmo"
                                                                ? "settlement-box tutorial-focus-ring active"
                                                                : "settlement-box tutorial-focus-ring", onMouseEnter: () => setTutorialHoverTarget("payment"), onMouseLeave: () => setTutorialHoverTarget(null), children: [_jsxs("div", { className: "settlement-heading", children: [_jsx("span", { className: "kicker", children: "Pending tutorial receipt" }), _jsx("strong", { children: "Fake payment confirmation" })] }), _jsxs("p", { className: "trade-note pending-note", children: ["Practice pending: ", tutorialDraft.side, " for ", formatMoney(tutorialAmountNumber), ". In the real app, this stays pending until the creator confirms they got your Venmo."] }), _jsx("button", { className: "secondary-button tutorial-payment-button", type: "button", disabled: tutorialPracticeStep === "done", onClick: handleTutorialPaymentSent, children: tutorialPracticeStep === "done"
                                                                        ? "Practice payment confirmed"
                                                                        : "I sent the practice Venmo" })] })) : null] })] }), tutorialPracticeStep === "done" ? (_jsxs("div", { className: "tutorial-success-banner", children: [_jsx("strong", { children: "You\u2019ve completed the fake bet flow." }), _jsx("p", { children: "The live board uses the same steps: choose a side, enter an amount, save the position, then follow the payment confirmation prompt." })] })) : null] })) : null, _jsxs("div", { className: "onboarding-footer slideshow-controls", children: [_jsx("button", { className: "ghost-button", type: "button", disabled: onboardingStep === 0, onClick: () => setOnboardingStep((current) => Math.max(0, current - 1)), children: "Previous" }), onboardingStep < totalOnboardingSteps - 1 ? (_jsx("button", { className: "primary-button", type: "button", disabled: (isVenmoSlide && needsVenmoHandle) ||
                                                (isGroupSlide && needsFirstGroup) ||
                                                (isPracticeSlide && !canStartPractice), onClick: () => setOnboardingStep((current) => Math.min(totalOnboardingSteps - 1, current + 1)), children: isIntroSlide ? "Start tutorial" : isGroupSlide ? "Open live tutorial" : "Next" })) : (_jsx("button", { className: "primary-button", type: "button", disabled: !onboardingReady || tutorialPracticeStep !== "done", onClick: () => {
                                                persistOnboardingCompletion(profile.user.id);
                                                setShowOnboarding(false);
                                                setStatusMessage("Setup complete. Your desk is ready.");
                                            }, children: "Continue to dashboard" }))] })] }) })] }) }));
    }
    return (_jsxs("main", { className: "shell app-shell", children: [_jsx("section", { className: "dashboard-toolbar", children: _jsxs("div", { className: "toolbar-meta", children: [_jsxs("div", { className: "toolbar-balance", children: [_jsx("span", { className: "metric-label", children: "Net won / lost" }), _jsx("strong", { children: formatSignedMoney(profile?.user.balance ?? 0) })] }), _jsxs("div", { className: "toolbar-actions", children: [_jsx("button", { className: "toolbar-button", type: "button", onClick: () => setSettingsOpen((current) => !current), children: settingsOpen ? "Close settings" : "Settings" }), _jsx("button", { className: "toolbar-button toolbar-button-secondary", onClick: () => logout({
                                        logoutParams: {
                                            returnTo: window.location.origin
                                        }
                                    }), children: "Log out" })] })] }) }), error ? (_jsx("section", { className: "status-banner", children: _jsx("strong", { children: error }) })) : null, settingsOpen ? (_jsxs("section", { className: "settings-overlay", "aria-label": "Settings", children: [_jsx("button", { className: "settings-backdrop", type: "button", "aria-label": "Close settings", onClick: () => setSettingsOpen(false) }), _jsxs("article", { className: "panel settings-panel settings-modal", children: [_jsxs("div", { className: "panel-heading settings-modal-heading", children: [_jsxs("div", { children: [_jsx("p", { className: "kicker", children: "Settings" }), _jsx("h2", { children: "Groups and payments" })] }), _jsx("button", { className: "toolbar-button toolbar-button-secondary", type: "button", onClick: () => setSettingsOpen(false), children: "Close" })] }), _jsxs("div", { className: "settings-grid", children: [_jsxs("form", { onSubmit: handleSaveVenmoHandle, className: "form-stack compact-form", children: [_jsx("span", { className: "subtle-copy", children: "Your Venmo handle for payment instructions" }), _jsx("input", { value: venmoHandle, onChange: (event) => setVenmoHandle(event.target.value), placeholder: "@yourhandle", required: true }), _jsx("button", { className: "secondary-button", type: "submit", disabled: busyAction === "venmo", children: "Save Venmo" })] }), _jsxs("form", { onSubmit: handleCreateGroup, className: "form-stack compact-form", children: [_jsx("span", { className: "subtle-copy", children: "Create a new family group" }), _jsx("input", { value: groupName, onChange: (event) => setGroupName(event.target.value), placeholder: "The Parkers", required: true }), _jsx("button", { className: "primary-button", type: "submit", disabled: busyAction === "create-group", children: "Create group" })] }), _jsxs("form", { onSubmit: handleJoinGroup, className: "form-stack compact-form", children: [_jsx("span", { className: "subtle-copy", children: referralJoinCode ? "Invite link detected for this group" : "Join another family group" }), _jsx("input", { value: joinCode, onChange: (event) => setJoinCode(event.target.value.toUpperCase()), placeholder: "Join code", required: true }), _jsx("button", { className: "ghost-button", type: "submit", disabled: busyAction === "join-group", children: "Join group" })] })] })] })] })) : null, _jsxs("section", { className: "dashboard-grid", children: [_jsxs("aside", { className: "sidebar-stack", children: [_jsxs("article", { className: "panel family-strip family-panel", children: [_jsxs("div", { className: "panel-heading", children: [_jsxs("div", { children: [_jsx("p", { className: "kicker", children: "Current family" }), _jsx("h2", { children: selectedGroup?.name ?? "Choose a family group" })] }), _jsx("span", { className: "subtle-copy", children: selectedGroup ? `Join code ${selectedGroup.joinCode}` : "Pick a group in settings" })] }), _jsx("div", { className: "group-selector vertical", children: profile?.groups.map((group) => (_jsxs("button", { type: "button", className: selectedGroupId === group.id ? "group-pill active" : "group-pill", onClick: () => setSelectedGroupId(group.id), children: [_jsx("span", { children: group.name }), _jsx("strong", { children: group.role }), _jsx("small", { children: group.joinCode })] }, group.id))) }), _jsxs("div", { className: "family-strip-meta", children: [_jsxs("div", { className: "compact-metric", children: [_jsx("span", { className: "metric-label", children: "Members" }), _jsx("strong", { children: selectedGroup?.members.length ?? 0 })] }), _jsxs("div", { className: "compact-metric", children: [_jsx("span", { className: "metric-label", children: "Visible markets" }), _jsx("strong", { children: markets.length })] })] }), selectedGroup ? (_jsxs("div", { className: "invite-card", children: [_jsxs("div", { children: [_jsx("p", { className: "kicker", children: "Share link" }), _jsx("strong", { children: "Invite people with one tap instead of sending just the code." })] }), _jsx("p", { className: "subtle-copy invite-link-copy", children: selectedGroupInviteUrl }), _jsx("button", { className: "ghost-button", type: "button", onClick: () => void copyInviteLink(selectedGroup.joinCode), children: "Copy invite link" })] })) : null] }), _jsxs("article", { className: "panel leaderboard-panel", children: [_jsx("div", { className: "panel-heading", children: _jsxs("div", { children: [_jsx("p", { className: "kicker", children: "Members" }), _jsx("h2", { children: "Win / loss board" })] }) }), _jsx("div", { className: "member-grid sidebar-members", children: visibleMembers.map((member) => (_jsxs("div", { className: "member-card", children: [_jsxs("div", { children: [_jsx("strong", { children: member.displayName }), _jsx("span", { children: member.role })] }), _jsx("strong", { children: formatSignedMoney(member.balance) })] }, member.id))) })] })] }), _jsxs("section", { className: "main-stack", children: [_jsxs("article", { className: "panel create-panel", children: [_jsxs("div", { className: "panel-heading", children: [_jsxs("div", { children: [_jsx("p", { className: "kicker", children: "Hidden market" }), _jsx("h2", { children: "Launch a new thesis" })] }), selectedGroup ? _jsxs("span", { className: "subtle-copy", children: ["Live in ", selectedGroup.name] }) : null] }), _jsxs("form", { onSubmit: handleCreateMarket, className: "create-market-grid", children: [_jsxs("select", { value: targetUserId, onChange: (event) => setTargetUserId(event.target.value), required: true, children: [_jsx("option", { value: "", children: "Choose who the market is about" }), _jsx("option", { value: GENERAL_MARKET_VALUE, children: "General" }), selectedGroup?.members
                                                        .filter((member) => member.id !== profile?.user.id)
                                                        .map((member) => (_jsx("option", { value: member.id, children: member.displayName }, member.id)))] }), _jsx("input", { value: question, onChange: (event) => setQuestion(event.target.value), placeholder: "Will Alex announce the move before Labor Day?", required: true }), _jsx("textarea", { rows: 4, value: description, onChange: (event) => setDescription(event.target.value), placeholder: "Settlement notes, timeline, edge cases" }), _jsx("input", { type: "datetime-local", value: closesAt, onChange: (event) => setClosesAt(event.target.value), required: true }), _jsx("button", { className: "primary-button", type: "submit", disabled: !selectedGroupId || busyAction === "create-market", children: "Publish market" })] })] }), _jsxs("section", { className: "market-board", children: [_jsxs("div", { className: "panel-heading board-heading", children: [_jsxs("div", { children: [_jsx("p", { className: "kicker", children: "Market board" }), _jsx("h2", { children: selectedGroup?.name ?? "Choose a group" })] }), _jsx("span", { className: "subtle-copy", children: "General markets are visible to everyone. Person-specific markets stay hidden from the subject." })] }), markets.length === 0 ? (_jsxs("article", { className: "empty-panel", children: [_jsx("h3", { children: "No visible markets yet." }), _jsx("p", { children: "Once a market targets someone else in this group, it will show up here with editable positions and automatic settlement." })] })) : (_jsx("div", { className: "market-grid", children: markets.map((market) => {
                                            const draft = tradeDrafts[market.id] ?? {
                                                side: market.userPosition.noAmount > market.userPosition.yesAmount ? "NO" : "YES",
                                                amount: market.userPosition.totalAmount > 0
                                                    ? String(market.userPosition.totalAmount)
                                                    : DEFAULT_TRADE_AMOUNT
                                            };
                                            const canRemove = market.createdBy.id === profile?.user.id || selectedGroup?.role === "ADMIN";
                                            const recipientHandle = normalizeVenmoHandle(market.venmoRecipient.venmoHandle);
                                            const recipientUrl = getVenmoUrl(market.venmoRecipient.venmoHandle);
                                            return (_jsxs("article", { className: "market-panel", children: [_jsxs("div", { className: "market-topline", children: [_jsxs("div", { children: [_jsx("p", { className: "kicker", children: market.isGeneral ? "General market" : `About ${market.targetUser?.displayName ?? "Family member"}` }), _jsx("h3", { children: market.question })] }), _jsx("span", { className: `status-pill ${market.status.toLowerCase()}`, children: market.status })] }), market.description ? _jsx("p", { className: "market-copy", children: market.description }) : null, _jsxs("div", { className: "market-stats", children: [_jsxs("div", { children: [_jsx("span", { children: "YES" }), _jsxs("strong", { children: [Math.round(market.summary.yesPrice * 100), "%"] })] }), _jsxs("div", { children: [_jsx("span", { children: "Total pot" }), _jsx("strong", { children: formatMoney(market.summary.totalVolume) })] }), _jsxs("div", { children: [_jsx("span", { children: "Live stake" }), _jsx("strong", { children: formatMoney(market.userPosition.totalAmount) })] }), _jsxs("div", { children: [_jsx("span", { children: "Closes" }), _jsx("strong", { children: new Date(market.closesAt).toLocaleString() })] })] }), _jsxs("div", { className: "market-rail", children: [_jsxs("div", { className: "market-rail-card", children: [_jsx("span", { children: "Creator" }), _jsx("strong", { children: market.createdBy.displayName })] }), _jsxs("div", { className: "market-rail-card", children: [_jsx("span", { children: "Leading side" }), _jsx("strong", { children: market.summary.leadingSide })] }), _jsxs("div", { className: "market-rail-card", children: [_jsx("span", { children: "Payout to you" }), _jsx("strong", { children: formatMoney(market.userPayout) })] })] }), _jsxs("div", { className: "trade-box", children: [_jsxs("div", { className: "trade-toggle", children: [_jsx("button", { type: "button", className: draft.side === "YES" ? "toggle-button active-yes" : "toggle-button", onClick: () => updateTradeDraft(market.id, { side: "YES" }), children: "YES" }), _jsx("button", { type: "button", className: draft.side === "NO" ? "toggle-button active-no" : "toggle-button", onClick: () => updateTradeDraft(market.id, { side: "NO" }), children: "NO" })] }), _jsx("input", { type: "number", min: "0", value: draft.amount, onChange: (event) => updateTradeDraft(market.id, { amount: event.target.value }), placeholder: "Stake amount" }), _jsx("button", { className: "primary-button", type: "button", disabled: busyAction === `position-${market.id}` || market.status !== "OPEN", onClick: () => void handleSavePosition(market.id), children: market.userPosition.totalAmount > 0 ? "Update position" : "Place position" }), market.status === "OPEN" ? (_jsxs("p", { className: "trade-note", children: ["After saving, send ", formatMoney(Number(draft.amount || "0")), " to", " ", recipientUrl ? (_jsxs("a", { className: "venmo-link", href: recipientUrl, target: "_blank", rel: "noreferrer", children: ["@", recipientHandle] })) : (market.venmoRecipient.displayName), " ", "so the market creator can escrow the pool."] })) : null, market.userPendingPosition.totalAmount > 0 ? (_jsxs("p", { className: "trade-note pending-note", children: ["Pending confirmation: ", formatMoney(market.userPendingPosition.totalAmount), ". This will not affect the market until", " ", recipientUrl ? (_jsxs("a", { className: "venmo-link", href: recipientUrl, target: "_blank", rel: "noreferrer", children: ["@", recipientHandle] })) : (market.venmoRecipient.displayName), " ", "confirms receipt."] })) : null] }), market.pendingConfirmations.length > 0 && market.createdBy.id === profile?.user.id ? (_jsxs("div", { className: "settlement-box", children: [_jsxs("div", { className: "settlement-heading", children: [_jsx("span", { className: "kicker", children: "Pending receipts" }), _jsx("strong", { children: "Confirm Venmo before the stake goes live" })] }), _jsx("div", { className: "settlement-list", children: market.pendingConfirmations.map((pending) => (_jsxs("div", { className: "settlement-row pending-row", children: [_jsxs("div", { children: [_jsx("span", { children: pending.displayName }), _jsxs("small", { children: [pending.side, " for ", formatMoney(pending.amount)] })] }), _jsxs("div", { className: "market-footer-actions", children: [_jsx("button", { className: "ghost-button yes-outline", type: "button", disabled: busyAction === `confirm-${pending.positionId}`, onClick: () => void handleConfirmPosition(market.id, pending.positionId), children: "Confirm payment" }), _jsx("button", { className: "ghost-button no-outline", type: "button", disabled: busyAction === `reject-${pending.positionId}`, onClick: () => void handleRejectPosition(market.id, pending.positionId), children: "Reject" })] })] }, pending.positionId))) })] })) : null, market.status === "RESOLVED" && market.createdBy.id === profile?.user.id ? (_jsxs("div", { className: "settlement-box", children: [_jsxs("div", { className: "settlement-heading", children: [_jsx("span", { className: "kicker", children: "Creator payout sheet" }), _jsx("strong", { children: market.creatorPayoutsPendingCount === 0
                                                                            ? "All payouts confirmed"
                                                                            : "Send these payouts and wait for winners to confirm" })] }), market.creatorPayouts.length === 0 ? (_jsx("p", { className: "subtle-copy", children: "Nobody backed the winning side. Refund bettors if you handled this market off-platform." })) : (_jsx("div", { className: "settlement-list", children: market.payoutConfirmations.map((payout) => (_jsxs("div", { className: "settlement-row", children: [_jsxs("div", { children: [_jsx("span", { children: payout.displayName }), _jsxs("small", { children: [formatMoney(payout.amount), " \u00B7 ", payout.status.replaceAll("_", " ")] })] }), _jsxs("div", { className: "market-footer-actions", children: [_jsx("strong", { children: formatMoney(payout.amount) }), payout.status !== "CONFIRMED" ? (_jsx("button", { className: "ghost-button yes-outline", type: "button", disabled: busyAction === `payout-sent-${payout.id}`, onClick: () => void handleMarkPayoutSent(market.id, payout.id), children: payout.status === "PENDING_CREATOR" ? "Mark paid" : payout.status === "DISPUTED" ? "Re-prompt winner" : "Sent, awaiting reply" })) : null] })] }, payout.id))) }))] })) : null, market.status === "RESOLVED" && market.userPayoutConfirmation ? (_jsxs("div", { className: "settlement-box", children: [_jsxs("div", { className: "settlement-heading", children: [_jsx("span", { className: "kicker", children: "Payout check" }), _jsx("strong", { children: market.userPayoutConfirmation.status === "CONFIRMED"
                                                                            ? "You already confirmed receipt"
                                                                            : `Did ${market.createdBy.displayName} pay you ${formatMoney(market.userPayoutConfirmation.amount)}?` })] }), market.userPayoutConfirmation.status === "PENDING_RECIPIENT" || market.userPayoutConfirmation.status === "DISPUTED" ? (_jsxs("div", { className: "market-footer-actions", children: [_jsx("button", { className: "ghost-button yes-outline", type: "button", disabled: busyAction === `payout-response-${market.userPayoutConfirmation.id}`, onClick: () => void handleRespondToPayout(market.id, market.userPayoutConfirmation.id, true), children: "I was paid" }), _jsx("button", { className: "ghost-button no-outline", type: "button", disabled: busyAction === `payout-response-${market.userPayoutConfirmation.id}`, onClick: () => void handleRespondToPayout(market.id, market.userPayoutConfirmation.id, false), children: "Not yet" })] })) : market.userPayoutConfirmation.status === "PENDING_CREATOR" ? (_jsxs("p", { className: "subtle-copy", children: ["Waiting for ", market.createdBy.displayName, " to mark your payout as sent."] })) : (_jsx("p", { className: "subtle-copy", children: "Thanks. This market will disappear once every winner confirms." }))] })) : null, _jsxs("div", { className: "market-footer", children: [_jsxs("span", { className: "subtle-copy", children: ["Current split: ", formatMoney(market.userPosition.yesAmount), " YES / ", formatMoney(market.userPosition.noAmount), " NO"] }), _jsxs("div", { className: "market-footer-actions", children: [canRemove ? (_jsx("button", { className: "ghost-button", type: "button", disabled: busyAction === `delete-${market.id}` || market.status === "RESOLVED", onClick: () => void handleDeleteMarket(market.id), children: "Remove market" })) : null, selectedGroup?.role === "ADMIN" && market.status !== "RESOLVED" ? (_jsxs(_Fragment, { children: [_jsx("button", { className: "ghost-button yes-outline", type: "button", disabled: busyAction === `resolve-${market.id}`, onClick: () => void handleResolve(market.id, true), children: "Resolve YES" }), _jsx("button", { className: "ghost-button no-outline", type: "button", disabled: busyAction === `resolve-${market.id}`, onClick: () => void handleResolve(market.id, false), children: "Resolve NO" })] })) : null] })] })] }, market.id));
                                        }) }))] })] })] })] }));
}
