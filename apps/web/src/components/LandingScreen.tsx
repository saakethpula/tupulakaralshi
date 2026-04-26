import { formatMoney } from "../utils/format";

type LandingScreenProps = {
    onLogin: () => void;
};

export function LandingScreen({ onLogin }: LandingScreenProps) {
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
                        <button className="primary-button" onClick={onLogin}>
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
