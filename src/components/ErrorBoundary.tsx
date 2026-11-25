import React from 'react';
import { clearProjectStore } from '../storage/projectStore';

interface ErrorBoundaryState {
  hasError: boolean;
  message: string;
}

export class ErrorBoundary extends React.Component<
  { children: React.ReactNode },
  ErrorBoundaryState
> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = { hasError: false, message: '' };
  }

  static getDerivedStateFromError(error: unknown): ErrorBoundaryState {
    return {
      hasError: true,
      message: error instanceof Error ? error.message : String(error),
    };
  }

  private handleResetAndReload = async () => {
    await clearProjectStore();
    window.location.reload();
  };

  override render() {
    if (this.state.hasError) {
      return (
        <div
          dir="rtl"
          className="min-h-screen flex items-center justify-center bg-[#0c0c0c] text-[#f4ead2] p-6"
        >
          <div className="max-w-md w-full rounded-2xl bg-[#221c12] border border-[#5a4a2a] p-6 flex flex-col gap-4 text-center">
            <h1 className="text-lg font-bold text-[#EDD6A2]">
              حدث خلل أثناء تحميل الواجهة
            </h1>
            <p className="text-xs text-[#b8a684] leading-relaxed">
              قد تكون بعض البيانات المحفوظة مؤقتاً غير متوافقة. اضغط أدناه لإعادة تحميل
              الاستوديو بشكل نظيف.
            </p>
            {this.state.message && (
              <p
                dir="ltr"
                className="text-[11px] font-mono bg-[#17130c] border border-[#5a4a2a] rounded-lg p-2.5 text-rose-300 break-words"
              >
                {this.state.message}
              </p>
            )}
            <div className="flex items-center justify-center gap-2.5 pt-2">
              <button
                type="button"
                onClick={() => window.location.reload()}
                className="px-4 py-2.5 rounded-lg bg-[#17130c] border border-[#5a4a2a] hover:border-[#d4a73a] text-[#f4ead2] text-xs font-semibold cursor-pointer"
              >
                إعادة المحاولة
              </button>
              <button
                type="button"
                onClick={() => void this.handleResetAndReload()}
                className="px-4 py-2.5 rounded-lg bg-[#00B050] hover:bg-[#00c85b] text-white text-xs font-bold cursor-pointer"
              >
                تنظيف الذاكرة وإعادة التحميل
              </button>
            </div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
