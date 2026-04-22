import { FormEvent, useEffect, useMemo, useState } from "react";
import { useAuth0 } from "@auth0/auth0-react";
import {
  confirmPosition,
  createGroup,
  createMarket,
  deleteMarket,
  getCurrentUser,
  getMarkets,
  joinGroup,
  markPayoutSent,
  rejectPosition,
  respondToPayout,
  resolveMarket,
  updateVenmoHandle,
  upsertPosition,
  type CurrentUserResponse,
  type Market
} from "./lib/api";

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

function formatMoney(amount: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0
  }).format(amount);
}

function formatSignedMoney(amount: number) {
  if (amount === 0) {
    return formatMoney(0);
  }

  return `${amount > 0 ? "+" : "-"}${formatMoney(Math.abs(amount))}`;
}

function normalizeVenmoHandle(handle: string | null | undefined) {
  return (handle ?? "").replace(/^@+/, "").trim();
}

function getVenmoUrl(handle: string | null | undefined) {
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

function buildGroupInviteUrl(joinCode: string) {
  if (typeof window === "undefined") {
    return "";
  }

  const inviteUrl = new URL(window.location.origin + window.location.pathname);
  inviteUrl.searchParams.set("groupCode", joinCode);
  return inviteUrl.toString();
}

function getOnboardingStorageKey(userId: string) {
  return `${ONBOARDING_STORAGE_PREFIX}${userId}`;
}

function getOnboardingCookieName(userId: string) {
  return `${ONBOARDING_COOKIE_PREFIX}${userId}`;
}

function readCookie(name: string) {
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

function hasCompletedOnboarding(userId: string) {
  const onboardingStorageKey = getOnboardingStorageKey(userId);
  const onboardingCookieName = getOnboardingCookieName(userId);

  try {
    if (window.localStorage.getItem(onboardingStorageKey) === "true") {
      return true;
    }
  } catch {
    // Fall back to the cookie copy when localStorage is unavailable or corrupted.
  }

  return readCookie(onboardingCookieName) === "true";
}

function persistOnboardingCompletion(userId: string) {
  const onboardingStorageKey = getOnboardingStorageKey(userId);
  const onboardingCookieName = getOnboardingCookieName(userId);

  try {
    window.localStorage.setItem(onboardingStorageKey, "true");
  } catch {
    // Cookie persistence still keeps onboarding complete if localStorage is unavailable.
  }

  document.cookie = `${onboardingCookieName}=true; Max-Age=${ONBOARDING_COOKIE_MAX_AGE_SECONDS}; Path=/; SameSite=Lax`;
}

type TradeDraft = {
  side: "YES" | "NO";
  amount: string;
};

export default function App() {
  const {
    isAuthenticated,
    isLoading,
    loginWithRedirect,
    logout,
    user,
    getAccessTokenSilently
  } = useAuth0();

  const [token, setToken] = useState("");
  const [profile, setProfile] = useState<CurrentUserResponse | null>(null);
  const [selectedGroupId, setSelectedGroupId] = useState("");
  const [markets, setMarkets] = useState<Market[]>([]);
  const [tradeDrafts, setTradeDrafts] = useState<Record<string, TradeDraft>>({});
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
  const [groupSetupMode, setGroupSetupMode] = useState<"join" | "create">("join");
  const [tutorialDraft, setTutorialDraft] = useState<TradeDraft>({ side: "YES", amount: DEFAULT_TRADE_AMOUNT });
  const [tutorialPracticeStep, setTutorialPracticeStep] = useState<
    "pick-side" | "enter-amount" | "submit-bet" | "send-venmo" | "done"
  >("pick-side");
  const [tutorialHoverTarget, setTutorialHoverTarget] = useState<
    "side" | "amount" | "submit" | "payment" | null
  >(null);
  const [tutorialBetPlaced, setTutorialBetPlaced] = useState(false);

  const selectedGroup = useMemo(
    () => profile?.groups.find((group) => group.id === selectedGroupId) ?? null,
    [profile, selectedGroupId]
  );

  const visibleMembers = useMemo(
    () =>
      [...(selectedGroup?.members ?? [])].sort((left, right) => right.balance - left.balance),
    [selectedGroup]
  );

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

  const tutorialPrompt =
    tutorialHoverTarget === "side"
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

  async function refreshProfile(accessToken: string) {
    const nextProfile = await getCurrentUser(accessToken);
    setProfile(nextProfile);
    setVenmoHandle(nextProfile.user.venmoHandle ?? "");
    return nextProfile;
  }

  async function refreshMarkets(accessToken: string, groupId: string) {
    const nextMarkets = await getMarkets(accessToken, groupId);
    setMarkets(nextMarkets);
    setTradeDrafts((currentDrafts) => {
      const nextDrafts = { ...currentDrafts };

      for (const market of nextMarkets) {
        if (!nextDrafts[market.id]) {
          nextDrafts[market.id] = {
            side: market.userPosition.noAmount > market.userPosition.yesAmount ? "NO" : "YES",
            amount:
              market.userPosition.totalAmount > 0
                ? String(market.userPosition.totalAmount)
                : DEFAULT_TRADE_AMOUNT
          };
        }
      }

      return nextDrafts;
    });
  }

  async function refreshWorkspace(accessToken: string, groupId: string) {
    await Promise.all([refreshProfile(accessToken), refreshMarkets(accessToken, groupId)]);
  }

  async function copyInviteLink(joinCodeToShare: string) {
    const inviteUrl = buildGroupInviteUrl(joinCodeToShare);

    if (!inviteUrl) {
      return;
    }

    try {
      await navigator.clipboard.writeText(inviteUrl);
      setStatusMessage("Invite link copied.");
      setError("");
    } catch (requestError) {
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
      } catch (requestError) {
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
        } else if (selectedGroupId && !nextProfile.groups.some((group) => group.id === selectedGroupId)) {
          setSelectedGroupId(nextProfile.groups[0]?.id ?? "");
        }

        if (selectedGroupId) {
          await refreshMarkets(token, selectedGroupId);
        }

        setError("");
      } catch (requestError) {
        if (!active) {
          return;
        }

        setError(requestError instanceof Error ? requestError.message : "Failed to refresh live data.");
      } finally {
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
      } catch (requestError) {
        setError(requestError instanceof Error ? requestError.message : "Failed to join group.");
      } finally {
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

  function updateTradeDraft(marketId: string, patch: Partial<TradeDraft>) {
    setTradeDrafts((currentDrafts) => ({
      ...currentDrafts,
      [marketId]: {
        side: currentDrafts[marketId]?.side ?? "YES",
        amount: currentDrafts[marketId]?.amount ?? DEFAULT_TRADE_AMOUNT,
        ...patch
      }
    }));
  }

  function handleTutorialSideChange(side: "YES" | "NO") {
    setTutorialDraft((current) => ({
      ...current,
      side
    }));
    if (tutorialPracticeStep === "pick-side") {
      setTutorialPracticeStep("enter-amount");
    }
  }

  function handleTutorialAmountChange(amount: string) {
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

  async function handleCreateGroup(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setBusyAction("create-group");

    try {
      const group = await createGroup(token, groupName);
      setSelectedGroupId(group.id);
      setGroupName("");
      await refreshWorkspace(token, group.id);
      setStatusMessage(`Created ${group.name}.`);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Failed to create group.");
    } finally {
      setBusyAction("");
    }
  }

  async function handleJoinGroup(event: FormEvent<HTMLFormElement>) {
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
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Failed to join group.");
    } finally {
      setBusyAction("");
    }
  }

  async function handleSaveVenmoHandle(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setBusyAction("venmo");

    try {
      await updateVenmoHandle(token, venmoHandle);
      await refreshProfile(token);
      setStatusMessage(`Venmo handle saved as @${normalizeVenmoHandle(venmoHandle)}.`);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Failed to save Venmo handle.");
    } finally {
      setBusyAction("");
    }
  }

  async function handleCreateMarket(event: FormEvent<HTMLFormElement>) {
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
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Failed to create market.");
    } finally {
      setBusyAction("");
    }
  }

  async function handleSavePosition(marketId: string) {
    const draft = tradeDrafts[marketId] ?? { side: "YES" as const, amount: DEFAULT_TRADE_AMOUNT };
    setError("");
    setBusyAction(`position-${marketId}`);

    try {
      const updatedMarket = await upsertPosition(token, marketId, {
        side: draft.side,
        amount: Number(draft.amount || "0")
      });
      await refreshWorkspace(token, selectedGroupId);
      setStatusMessage(
        Number(draft.amount || "0") > 0
          ? `Position submitted. Send ${formatMoney(Number(draft.amount || "0"))} using the Venmo link for ${updatedMarket.venmoRecipient.venmoHandle ? `@${normalizeVenmoHandle(updatedMarket.venmoRecipient.venmoHandle)}` : updatedMarket.venmoRecipient.displayName}, then wait for creator confirmation.`
          : "Position removed."
      );
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Failed to save position.");
    } finally {
      setBusyAction("");
    }
  }

  async function handleConfirmPosition(marketId: string, positionId: string) {
    setError("");
    setBusyAction(`confirm-${positionId}`);

    try {
      await confirmPosition(token, marketId, positionId);
      await refreshWorkspace(token, selectedGroupId);
      setStatusMessage("Payment confirmed. The position is now live on the market.");
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Failed to confirm payment.");
    } finally {
      setBusyAction("");
    }
  }

  async function handleRejectPosition(marketId: string, positionId: string) {
    setError("");
    setBusyAction(`reject-${positionId}`);

    try {
      await rejectPosition(token, marketId, positionId);
      await refreshWorkspace(token, selectedGroupId);
      setStatusMessage("Pending position rejected.");
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Failed to reject payment.");
    } finally {
      setBusyAction("");
    }
  }

  async function handleResolve(marketId: string, resolution: boolean) {
    setError("");
    setBusyAction(`resolve-${marketId}`);

    try {
      await resolveMarket(token, marketId, resolution);
      await refreshWorkspace(token, selectedGroupId);
      setStatusMessage("Market resolved and win/loss totals updated.");
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Failed to resolve market.");
    } finally {
      setBusyAction("");
    }
  }

  async function handleDeleteMarket(marketId: string) {
    setError("");
    setBusyAction(`delete-${marketId}`);

    try {
      await deleteMarket(token, marketId);
      await refreshWorkspace(token, selectedGroupId);
      setStatusMessage("Market removed and all positions refunded.");
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Failed to remove market.");
    } finally {
      setBusyAction("");
    }
  }

  async function handleMarkPayoutSent(marketId: string, payoutId: string) {
    setError("");
    setBusyAction(`payout-sent-${payoutId}`);

    try {
      await markPayoutSent(token, marketId, payoutId);
      await refreshWorkspace(token, selectedGroupId);
      setStatusMessage("Payout marked as sent. The winner will now be asked to confirm receipt.");
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Failed to mark payout as sent.");
    } finally {
      setBusyAction("");
    }
  }

  async function handleRespondToPayout(marketId: string, payoutId: string, received: boolean) {
    setError("");
    setBusyAction(`payout-response-${payoutId}`);

    try {
      await respondToPayout(token, marketId, payoutId, received);
      await refreshWorkspace(token, selectedGroupId);
      setStatusMessage(
        received
          ? "Payout confirmed. Once every winner confirms, this market will disappear from the board."
          : "Payout dispute sent back to the creator. They need to send payment again."
      );
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Failed to respond to payout confirmation.");
    } finally {
      setBusyAction("");
    }
  }

  if (isLoading) {
    return <main className="shell"><section className="loading-panel">Loading authentication...</section></main>;
  }

  if (!isAuthenticated) {
    return (
      <main className="shell landing-shell">
        <section className="landing-hero">
          <div className="hero-copy">
            <p className="kicker">Family Prediction Market</p>
            <h1>Private forecasting with sharper stakes and cleaner secrets.</h1>
            <p className="hero-lede">
              Spin up hidden markets, track family predictions, and settle results automatically in a dashboard that feels more like a modern trading desk than a school project.
            </p>
            <div className="hero-actions">
              <button
                className="primary-button"
                onClick={() =>
                  void loginWithRedirect({
                    appState: {
                      returnTo: `${window.location.pathname}${window.location.search}${window.location.hash}`
                    }
                  })
                }
              >
                Enter the market
              </button>
              <div className="hero-note">
                Hidden from the subject, visible to the family, settled through real payment tracking.
              </div>
            </div>
          </div>
          <div className="hero-preview">
            <div className="preview-card">
              <span className="preview-label">Live signal</span>
              <strong>72% YES</strong>
              <p>Will Jordan finally announce the move before July?</p>
            </div>
            <div className="preview-card">
              <span className="preview-label">Win / loss tracker</span>
              <strong>+{formatMoney(1240)}</strong>
              <p>Track how much each person is up or down after markets resolve.</p>
            </div>
          </div>
        </section>
      </main>
    );
  }

  if (!profile) {
    return (
      <main className="shell">
        <section className="loading-panel">Loading your workspace...</section>
      </main>
    );
  }

  if (showOnboarding) {
    const progressCount = onboardingStep + 1;
    const progressPercent = (progressCount / totalOnboardingSteps) * 100;

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
                <span className="subtle-copy">Screen {progressCount} of {totalOnboardingSteps}</span>
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

                  <form onSubmit={handleSaveVenmoHandle} className="compact-form form-stack single-step-form">
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
                    <form onSubmit={handleJoinGroup} className="compact-form form-stack single-step-form">
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
                    <form onSubmit={handleCreateGroup} className="compact-form form-stack single-step-form">
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
                            onClick={() => handleTutorialSideChange("YES")}
                          >
                            YES
                          </button>
                          <button
                            type="button"
                            className={tutorialDraft.side === "NO" ? "toggle-button active-no" : "toggle-button"}
                            onClick={() => handleTutorialSideChange("NO")}
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
                          onChange={(event) => handleTutorialAmountChange(event.target.value)}
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
                          onClick={handleTutorialPlaceBet}
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
                            onClick={handleTutorialPaymentSent}
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

                {onboardingStep < totalOnboardingSteps - 1 ? (
                  <button
                    className="primary-button"
                    type="button"
                    disabled={
                      (isVenmoSlide && needsVenmoHandle) ||
                      (isGroupSlide && needsFirstGroup) ||
                      (isPracticeSlide && !canStartPractice)
                    }
                    onClick={() => setOnboardingStep((current) => Math.min(totalOnboardingSteps - 1, current + 1))}
                  >
                    {isIntroSlide ? "Start tutorial" : isGroupSlide ? "Open live tutorial" : "Next"}
                  </button>
                ) : (
                  <button
                    className="primary-button"
                    type="button"
                    disabled={!onboardingReady || tutorialPracticeStep !== "done"}
                    onClick={() => {
                      persistOnboardingCompletion(profile.user.id);
                      setShowOnboarding(false);
                      setStatusMessage("Setup complete. Your desk is ready.");
                    }}
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

  return (
    <main className="shell app-shell">
      <section className="dashboard-toolbar">
        <div className="toolbar-meta">
          <div className="toolbar-balance">
            <span className="metric-label">Net won / lost</span>
            <strong>{formatSignedMoney(profile?.user.balance ?? 0)}</strong>
          </div>
          <div className="toolbar-actions">
            <button
              className="toolbar-button"
              type="button"
              onClick={() => setSettingsOpen((current) => !current)}
            >
              {settingsOpen ? "Close settings" : "Settings"}
            </button>
            <button
              className="toolbar-button toolbar-button-secondary"
              onClick={() =>
                logout({
                  logoutParams: {
                    returnTo: window.location.origin
                  }
                })
              }
            >
              Log out
            </button>
          </div>
        </div>
      </section>

      {error ? (
        <section className="status-banner">
          <strong>{error}</strong>
        </section>
      ) : null}

      {settingsOpen ? (
        <section className="settings-overlay" aria-label="Settings">
          <button
            className="settings-backdrop"
            type="button"
            aria-label="Close settings"
            onClick={() => setSettingsOpen(false)}
          />
          <article className="panel settings-panel settings-modal">
            <div className="panel-heading settings-modal-heading">
              <div>
                <p className="kicker">Settings</p>
                <h2>Groups and payments</h2>
              </div>
              <button
                className="toolbar-button toolbar-button-secondary"
                type="button"
                onClick={() => setSettingsOpen(false)}
              >
                Close
              </button>
            </div>
            <div className="settings-grid">
              <form onSubmit={handleSaveVenmoHandle} className="form-stack compact-form">
                <span className="subtle-copy">Your Venmo handle for payment instructions</span>
                <input
                  value={venmoHandle}
                  onChange={(event) => setVenmoHandle(event.target.value)}
                  placeholder="@yourhandle"
                  required
                />
                <button
                  className="secondary-button"
                  type="submit"
                  disabled={busyAction === "venmo"}
                >
                  Save Venmo
                </button>
              </form>

              <form onSubmit={handleCreateGroup} className="form-stack compact-form">
                <span className="subtle-copy">Create a new family group</span>
                <input
                  value={groupName}
                  onChange={(event) => setGroupName(event.target.value)}
                  placeholder="The Parkers"
                  required
                />
                <button className="primary-button" type="submit" disabled={busyAction === "create-group"}>
                  Create group
                </button>
              </form>

              <form onSubmit={handleJoinGroup} className="form-stack compact-form">
                <span className="subtle-copy">
                  {referralJoinCode ? "Invite link detected for this group" : "Join another family group"}
                </span>
                <input
                  value={joinCode}
                  onChange={(event) => setJoinCode(event.target.value.toUpperCase())}
                  placeholder="Join code"
                  required
                />
                <button className="ghost-button" type="submit" disabled={busyAction === "join-group"}>
                  Join group
                </button>
              </form>
            </div>
          </article>
        </section>
      ) : null}

      <section className="dashboard-grid">
        <aside className="sidebar-stack">
          <article className="panel family-strip family-panel">
            <div className="panel-heading">
              <div>
                <p className="kicker">Current family</p>
                <h2>{selectedGroup?.name ?? "Choose a family group"}</h2>
              </div>
              <span className="subtle-copy">
                {selectedGroup ? `Join code ${selectedGroup.joinCode}` : "Pick a group in settings"}
              </span>
            </div>
            <div className="group-selector vertical">
              {profile?.groups.map((group) => (
                <button
                  key={group.id}
                  type="button"
                  className={selectedGroupId === group.id ? "group-pill active" : "group-pill"}
                  onClick={() => setSelectedGroupId(group.id)}
                >
                  <span>{group.name}</span>
                  <strong>{group.role}</strong>
                  <small>{group.joinCode}</small>
                </button>
              ))}
            </div>
            <div className="family-strip-meta">
              <div className="compact-metric">
                <span className="metric-label">Members</span>
                <strong>{selectedGroup?.members.length ?? 0}</strong>
              </div>
              <div className="compact-metric">
                <span className="metric-label">Visible markets</span>
                <strong>{markets.length}</strong>
              </div>
            </div>
            {selectedGroup ? (
              <div className="invite-card">
                <div>
                  <p className="kicker">Share link</p>
                  <strong>Invite people with one tap instead of sending just the code.</strong>
                </div>
                <p className="subtle-copy invite-link-copy">{selectedGroupInviteUrl}</p>
                <button
                  className="ghost-button"
                  type="button"
                  onClick={() => void copyInviteLink(selectedGroup.joinCode)}
                >
                  Copy invite link
                </button>
              </div>
            ) : null}
          </article>

          <article className="panel leaderboard-panel">
            <div className="panel-heading">
              <div>
                <p className="kicker">Members</p>
                <h2>Win / loss board</h2>
              </div>
            </div>
            <div className="member-grid sidebar-members">
              {visibleMembers.map((member) => (
                <div key={member.id} className="member-card">
                  <div>
                    <strong>{member.displayName}</strong>
                    <span>{member.role}</span>
                  </div>
                  <strong>{formatSignedMoney(member.balance)}</strong>
                </div>
              ))}
            </div>
          </article>
        </aside>

        <section className="main-stack">

          <article className="panel create-panel">
            <div className="panel-heading">
              <div>
                <p className="kicker">Hidden market</p>
                <h2>Launch a new thesis</h2>
              </div>
              {selectedGroup ? <span className="subtle-copy">Live in {selectedGroup.name}</span> : null}
            </div>
            <form onSubmit={handleCreateMarket} className="create-market-grid">
              <select
                value={targetUserId}
                onChange={(event) => setTargetUserId(event.target.value)}
                required
              >
                <option value="">Choose who the market is about</option>
                <option value={GENERAL_MARKET_VALUE}>General</option>
                {selectedGroup?.members
                  .filter((member) => member.id !== profile?.user.id)
                  .map((member) => (
                    <option key={member.id} value={member.id}>
                      {member.displayName}
                    </option>
                  ))}
              </select>
              <input
                value={question}
                onChange={(event) => setQuestion(event.target.value)}
                placeholder="Will Alex announce the move before Labor Day?"
                required
              />
              <textarea
                rows={4}
                value={description}
                onChange={(event) => setDescription(event.target.value)}
                placeholder="Settlement notes, timeline, edge cases"
              />
              <input
                type="datetime-local"
                value={closesAt}
                onChange={(event) => setClosesAt(event.target.value)}
                required
              />
              <button
                className="primary-button"
                type="submit"
                disabled={!selectedGroupId || busyAction === "create-market"}
              >
                Publish market
              </button>
            </form>
          </article>

          <section className="market-board">
            <div className="panel-heading board-heading">
              <div>
                <p className="kicker">Market board</p>
                <h2>{selectedGroup?.name ?? "Choose a group"}</h2>
              </div>
              <span className="subtle-copy">
                General markets are visible to everyone. Person-specific markets stay hidden from the subject.
              </span>
            </div>

            {markets.length === 0 ? (
              <article className="empty-panel">
                <h3>No visible markets yet.</h3>
                <p>Once a market targets someone else in this group, it will show up here with editable positions and automatic settlement.</p>
              </article>
            ) : (
              <div className="market-grid">
                {markets.map((market) => {
                  const draft = tradeDrafts[market.id] ?? {
                    side: market.userPosition.noAmount > market.userPosition.yesAmount ? "NO" as const : "YES" as const,
                    amount:
                      market.userPosition.totalAmount > 0
                        ? String(market.userPosition.totalAmount)
                        : DEFAULT_TRADE_AMOUNT
                  };
                  const canRemove =
                    market.createdBy.id === profile?.user.id || selectedGroup?.role === "ADMIN";
                  const recipientHandle = normalizeVenmoHandle(market.venmoRecipient.venmoHandle);
                  const recipientUrl = getVenmoUrl(market.venmoRecipient.venmoHandle);

                  return (
                    <article key={market.id} className="market-panel">
                      <div className="market-topline">
                        <div>
                          <p className="kicker">
                            {market.isGeneral ? "General market" : `About ${market.targetUser?.displayName ?? "Family member"}`}
                          </p>
                          <h3>{market.question}</h3>
                        </div>
                        <span className={`status-pill ${market.status.toLowerCase()}`}>{market.status}</span>
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
                            onClick={() => updateTradeDraft(market.id, { side: "YES" })}
                          >
                            YES
                          </button>
                          <button
                            type="button"
                            className={draft.side === "NO" ? "toggle-button active-no" : "toggle-button"}
                            onClick={() => updateTradeDraft(market.id, { side: "NO" })}
                          >
                            NO
                          </button>
                        </div>
                        <input
                          type="number"
                          min="0"
                          value={draft.amount}
                          onChange={(event) => updateTradeDraft(market.id, { amount: event.target.value })}
                          placeholder="Stake amount"
                        />
                        <button
                          className="primary-button"
                          type="button"
                          disabled={busyAction === `position-${market.id}` || market.status !== "OPEN"}
                          onClick={() => void handleSavePosition(market.id)}
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

                      {market.pendingConfirmations.length > 0 && market.createdBy.id === profile?.user.id ? (
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
                                    onClick={() => void handleConfirmPosition(market.id, pending.positionId)}
                                  >
                                    Confirm payment
                                  </button>
                                  <button
                                    className="ghost-button no-outline"
                                    type="button"
                                    disabled={busyAction === `reject-${pending.positionId}`}
                                    onClick={() => void handleRejectPosition(market.id, pending.positionId)}
                                  >
                                    Reject
                                  </button>
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>
                      ) : null}

                      {market.status === "RESOLVED" && market.createdBy.id === profile?.user.id ? (
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
                                        onClick={() => void handleMarkPayoutSent(market.id, payout.id)}
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
                                onClick={() => void handleRespondToPayout(market.id, market.userPayoutConfirmation!.id, true)}
                              >
                                I was paid
                              </button>
                              <button
                                className="ghost-button no-outline"
                                type="button"
                                disabled={busyAction === `payout-response-${market.userPayoutConfirmation.id}`}
                                onClick={() => void handleRespondToPayout(market.id, market.userPayoutConfirmation!.id, false)}
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
                              onClick={() => void handleDeleteMarket(market.id)}
                            >
                              Remove market
                            </button>
                          ) : null}
                          {selectedGroup?.role === "ADMIN" && market.status !== "RESOLVED" ? (
                            <>
                              <button
                                className="ghost-button yes-outline"
                                type="button"
                                disabled={busyAction === `resolve-${market.id}`}
                                onClick={() => void handleResolve(market.id, true)}
                              >
                                Resolve YES
                              </button>
                              <button
                                className="ghost-button no-outline"
                                type="button"
                                disabled={busyAction === `resolve-${market.id}`}
                                onClick={() => void handleResolve(market.id, false)}
                              >
                                Resolve NO
                              </button>
                            </>
                          ) : null}
                        </div>
                      </div>
                    </article>
                  );
                })}
              </div>
            )}
          </section>
        </section>
      </section>
    </main>
  );
}
