import React from "react";

import "./app-recovery.css";

export class AppErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { failed: false };
  }

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error, errorInfo) {
    console.error("Application render failed", error, errorInfo);
  }

  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <main className="app-recovery" role="alert">
        <section>
          <p className="app-recovery-eyebrow">Workorders</p>
          <h1>This page couldn’t load</h1>
          <p>Your work is still saved. Reload the page to continue.</p>
          <button type="button" onClick={() => window.location.reload()}>Reload</button>
        </section>
      </main>
    );
  }
}

export function AppLoadingFallback() {
  return (
    <main className="app-recovery app-recovery-loading" aria-busy="true" aria-label="Loading Workorders">
      <span className="app-loading-indicator" aria-hidden="true" />
    </main>
  );
}
