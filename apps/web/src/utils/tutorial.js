import { DEFAULT_TRADE_AMOUNT } from "../constants/app";
export function resetTutorialState() {
    return {
        onboardingStep: 0,
        tutorialDraft: { side: "YES", amount: DEFAULT_TRADE_AMOUNT },
        tutorialPracticeStep: "pick-side",
        tutorialBetPlaced: false
    };
}
export function getTutorialPrompt(tutorialHoverTarget, tutorialPracticeStep) {
    if (tutorialHoverTarget === "side") {
        return "Pick the side you want to back. This mirrors the real YES / NO toggle in the live app.";
    }
    if (tutorialHoverTarget === "amount") {
        return "Enter a fake stake here. Nothing in this tutorial moves real money or changes the market.";
    }
    if (tutorialHoverTarget === "submit") {
        return "This is the same action you’ll use later on the real market board to save your position.";
    }
    if (tutorialHoverTarget === "payment") {
        return "After saving a real position, the app tells you who to Venmo and waits for payment confirmation.";
    }
    if (tutorialPracticeStep === "pick-side") {
        return "Step 1: choose YES or NO on this fake market to start the tutorial bet.";
    }
    if (tutorialPracticeStep === "enter-amount") {
        return "Step 2: type the amount you want to stake. Try something like 5.";
    }
    if (tutorialPracticeStep === "submit-bet") {
        return "Step 3: submit the fake bet so you can see the payment instructions.";
    }
    if (tutorialPracticeStep === "send-venmo") {
        return "Step 4: simulate sending the Venmo so you can see how a pending confirmation works.";
    }
    return "Tutorial complete. You’ve walked through the full fake bet flow and can open the real dashboard.";
}
