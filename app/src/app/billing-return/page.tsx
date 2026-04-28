import { Suspense } from "react";
import BillingReturnInner from "./BillingReturnInner";

export default function BillingReturnPage() {
  return (
    <Suspense
      fallback={
        <div className="max-w-lg mx-auto px-6 py-20 text-center">
          <div className="bg-white border border-slate-200 rounded-xl shadow-sm p-10">
            <div className="w-12 h-12 rounded-full border-4 border-teal-200 border-t-teal-600 animate-spin mx-auto mb-6" />
            <h1 className="text-xl font-bold text-slate-900 mb-2">
              Updating your subscription…
            </h1>
            <p className="text-slate-500 text-sm">
              One moment while we refresh your account.
            </p>
          </div>
        </div>
      }
    >
      <BillingReturnInner />
    </Suspense>
  );
}
