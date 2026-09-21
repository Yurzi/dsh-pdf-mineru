import type { ReactNode } from 'react';
export interface DisclosureCardProps {
    readonly id: string;
    readonly title: string;
    readonly subtitle?: string;
    readonly icon?: ReactNode;
    readonly badge?: ReactNode;
    readonly open: boolean;
    readonly onToggle: () => void;
    readonly action?: ReactNode;
    readonly toggleTitle?: string;
    readonly children: ReactNode;
    readonly className?: string;
}
export declare function DisclosureCard({ id, title, subtitle, icon, badge, open, onToggle, action, toggleTitle, children, className, }: DisclosureCardProps): import("react").JSX.Element;
