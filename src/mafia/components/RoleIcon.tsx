import { Search, Shield, Skull, Syringe, User } from "lucide-react";
import type { Role } from "../types";

const ICONS = { mafia: Skull, police: Search, doctor: Syringe, soldier: Shield, citizen: User } as const;

export function RoleIcon({ role, className = "h-4 w-4" }: { role: Role; className?: string }) {
  const Icon = ICONS[role];
  return <Icon className={className} aria-hidden />;
}
