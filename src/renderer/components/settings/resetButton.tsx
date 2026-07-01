/** Shared text-action reset button used by ColorAdjustmentsSection and UiScaleSection. */
export function ResetButton({ label, onClick }: { label: string; onClick: () => void }) {
    return (
        <button
            type="button"
            className="rokdock-reset-link"
            onClick={onClick}
        >
            {label}
        </button>
    )
}
