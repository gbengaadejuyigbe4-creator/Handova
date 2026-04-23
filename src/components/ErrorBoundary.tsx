import { Component, type ReactNode, type ErrorInfo } from "react";
import { AlertTriangle, RefreshCw } from "lucide-react";

interface ErrorBoundaryProps {
  children: ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}

export default class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("[Handova] UI Error:", error, info);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen bg-[#020818] flex items-center justify-center px-4">
          <div className="max-w-md w-full bg-[#050f2c] border border-red-900/50 rounded-xl p-8 text-center">
            <div className="w-12 h-12 rounded-full bg-red-500/20 border border-red-500/40 flex items-center justify-center mx-auto mb-4">
              <AlertTriangle size={22} className="text-red-400" />
            </div>
            <h2 className="font-display text-lg font-bold text-white mb-2">
              Something went wrong
            </h2>
            <p className="text-sm text-slate-400 mb-6">
              An unexpected error occurred. Your data has not been lost — refreshing should fix this.
            </p>
            {this.state.error && (
              <p className="text-xs text-red-400 bg-red-900/20 rounded-lg px-3 py-2 mb-6 font-mono text-left">
                {this.state.error.message}
              </p>
            )}
            <button
              onClick={() => window.location.reload()}
              className="flex items-center gap-2 bg-teal-500 hover:bg-teal-400 text-[#020818] font-semibold px-5 py-2.5 rounded-lg text-sm transition-all mx-auto"
            >
              <RefreshCw size={14} />
              Refresh App
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
