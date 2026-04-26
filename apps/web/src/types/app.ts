export type TradeDraft = {
    side: "YES" | "NO";
    amount: string;
};

export type GroupSetupMode = "join" | "create";

export type TutorialPracticeStep =
    | "pick-side"
    | "enter-amount"
    | "submit-bet"
    | "send-venmo"
    | "done";

export type TutorialHoverTarget = "side" | "amount" | "submit" | "payment" | null;

export type TutorialState = {
    onboardingStep: number;
    tutorialDraft: TradeDraft;
    tutorialPracticeStep: TutorialPracticeStep;
    tutorialBetPlaced: boolean;
};

export type ThemePreference = "system" | "light" | "dark";

export type ResolvedTheme = "light" | "dark";
