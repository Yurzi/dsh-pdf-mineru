export interface NumericInputProps {
    readonly className?: string;
    readonly value: number;
    readonly min?: number;
    readonly max?: number;
    readonly step?: number;
    readonly disabled?: boolean;
    readonly placeholder?: string;
    readonly title?: string;
    readonly onChange: (value: number) => void;
}
export declare function parseNumericDraft(draft: string, min?: number, max?: number): {
    valid: boolean;
    value?: number;
};
export declare function clampNumericDraft(draft: string, fallback: number, min?: number, max?: number): {
    nextDraft: string;
    value: number;
    changed: boolean;
};
export declare function NumericInput({ className, value, min, max, step, disabled, placeholder, title, onChange, }: NumericInputProps): import("react").JSX.Element;
