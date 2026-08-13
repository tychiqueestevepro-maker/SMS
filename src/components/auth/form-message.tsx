import { CircleAlert, CircleCheck } from "lucide-react";

export function FormMessage({ error, success }: { error?: string; success?: string }) {
  const message = error ?? success;
  if (!message) return null;

  return (
    <div
      className={`mb-5 flex items-start gap-2.5 rounded-lg border px-3.5 py-3 text-sm leading-5 ${
        error
          ? "border-[#f0cbc6] bg-[#fff3f1] text-[#8f312a]"
          : "border-[#cce2d3] bg-[#eff8f2] text-[#235f43]"
      }`}
      role={error ? "alert" : "status"}
    >
      {error ? (
        <CircleAlert aria-hidden="true" className="mt-0.5 shrink-0" size={16} />
      ) : (
        <CircleCheck aria-hidden="true" className="mt-0.5 shrink-0" size={16} />
      )}
      <span>{message}</span>
    </div>
  );
}
