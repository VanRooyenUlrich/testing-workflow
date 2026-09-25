import { BackendStatus } from "../components/backend-status";

export default function Home() {
  return (
    <div className="home-grid">
      <section className="hero" aria-labelledby="home-title">
        <p className="eyebrow">Proof of concept</p>
        <h1 id="home-title">Keep work visible and moving.</h1>
        <p className="hero-copy">
          This initial Issue Tracker frontend establishes the application shell
          and confirms that the browser can reach the backend health endpoint.
        </p>
      </section>
      <BackendStatus />
    </div>
  );
}