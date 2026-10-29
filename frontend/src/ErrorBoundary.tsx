import { Component, type ErrorInfo, type ReactNode } from "react";

/** If a screen breaks, say so plainly and offer a reload, instead of a blank page. */
export class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("Tadabbur stopped:", error, info.componentStack);
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <main className="crash" dir="ltr" role="alert">
        <h1 className="ar">تدبّر</h1>
        <p>Something went wrong on this page. Your notes and words are safe.</p>
        <button onClick={() => window.location.reload()}>reload</button>
        <code>{this.state.error.message}</code>
      </main>
    );
  }
}
