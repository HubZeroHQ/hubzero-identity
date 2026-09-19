type IconProps = { size?: number; className?: string };

function Icon({ children, size = 18, className }: IconProps & { children: React.ReactNode }) {
  return <svg className={className} width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{children}</svg>;
}

export const UserIcon = (p: IconProps) => <Icon {...p}><circle cx="12" cy="8" r="3.5"/><path d="M5.5 20c.6-4 2.7-6 6.5-6s5.9 2 6.5 6"/></Icon>;
export const ShieldIcon = (p: IconProps) => <Icon {...p}><path d="M12 3 5.5 5.7v5.7c0 4.1 2.6 7.6 6.5 9.6 3.9-2 6.5-5.5 6.5-9.6V5.7L12 3Z"/><path d="m9.4 12 1.7 1.7 3.6-4"/></Icon>;
export const DeviceIcon = (p: IconProps) => <Icon {...p}><rect x="3.5" y="4" width="17" height="12" rx="1.5"/><path d="M8 20h8m-4-4v4"/></Icon>;
export const GridIcon = (p: IconProps) => <Icon {...p}><rect x="4" y="4" width="6" height="6" rx="1"/><rect x="14" y="4" width="6" height="6" rx="1"/><rect x="4" y="14" width="6" height="6" rx="1"/><rect x="14" y="14" width="6" height="6" rx="1"/></Icon>;
export const OverviewIcon = (p: IconProps) => <Icon {...p}><path d="M4 11.5 12 4l8 7.5"/><path d="M6.5 10v9h11v-9"/></Icon>;
export const ArrowIcon = (p: IconProps) => <Icon {...p}><path d="M5 12h14m-5-5 5 5-5 5"/></Icon>;
export const KeyIcon = (p: IconProps) => <Icon {...p}><circle cx="8" cy="15" r="4"/><path d="m11 12 8-8m-3 3 2 2m-5 1 2 2"/></Icon>;
export const CheckIcon = (p: IconProps) => <Icon {...p}><path d="m5 12.5 4.2 4.2L19 7"/></Icon>;
export const AlertIcon = (p: IconProps) => <Icon {...p}><path d="M12 4 3.8 19h16.4L12 4Z"/><path d="M12 9v4m0 3h.01"/></Icon>;
