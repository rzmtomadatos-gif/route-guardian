import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { Users, Loader2 } from 'lucide-react';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { toast } from 'sonner';
import type { AppRole } from '@/hooks/useUserRole';

interface UserWithRole {
  id: string;
  email: string | null;
  full_name: string | null;
  role: AppRole | null;
}

const ROLE_LABELS: Record<AppRole, string> = {
  admin: 'Administrador',
  operator: 'Operador',
  gabinete: 'Gabinete',
  supervisor: 'Supervisor',
};

export function UserRolesManager() {
  const { user } = useAuth();
  const [users, setUsers] = useState<UserWithRole[]>([]);
  const [loading, setLoading] = useState(true);
  const [updating, setUpdating] = useState<string | null>(null);

  const fetchUsers = async () => {
    setLoading(true);
    const { data: profiles, error: pErr } = await supabase
      .from('profiles')
      .select('id, email, full_name');

    if (pErr) {
      toast.error('Error cargando usuarios');
      setLoading(false);
      return;
    }

    const { data: roles, error: rErr } = await supabase
      .from('user_roles')
      .select('user_id, role');

    if (rErr) {
      toast.error('Error cargando roles');
      setLoading(false);
      return;
    }

    const roleMap = new Map(roles?.map((r) => [r.user_id, r.role as AppRole]) ?? []);

    setUsers(
      (profiles ?? []).map((p) => ({
        id: p.id,
        email: p.email,
        full_name: p.full_name,
        role: roleMap.get(p.id) ?? null,
      }))
    );
    setLoading(false);
  };

  useEffect(() => {
    fetchUsers();
  }, []);

  const handleRoleChange = async (userId: string, newRole: AppRole) => {
    if (userId === user?.id) {
      toast.error('No puedes cambiar tu propio rol');
      return;
    }

    setUpdating(userId);
    try {
      // Check if user already has a role entry
      const existing = users.find((u) => u.id === userId);
      if (existing?.role) {
        // Update
        const { error } = await supabase
          .from('user_roles')
          .update({ role: newRole })
          .eq('user_id', userId);
        if (error) throw error;
      } else {
        // Insert
        const { error } = await supabase
          .from('user_roles')
          .insert({ user_id: userId, role: newRole });
        if (error) throw error;
      }

      setUsers((prev) =>
        prev.map((u) => (u.id === userId ? { ...u, role: newRole } : u))
      );
      toast.success(`Rol actualizado a ${ROLE_LABELS[newRole]}`);
    } catch (e: any) {
      toast.error(`Error actualizando rol: ${e.message}`);
    } finally {
      setUpdating(null);
    }
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 text-muted-foreground">
        <Users className="w-4 h-4" />
        <span className="text-sm font-medium">Gestión de roles</span>
      </div>
      <div className="bg-card rounded-xl p-4 border border-border space-y-3">
        {loading ? (
          <div className="flex items-center justify-center py-4">
            <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
          </div>
        ) : users.length === 0 ? (
          <p className="text-xs text-muted-foreground">No hay usuarios registrados.</p>
        ) : (
          <div className="space-y-2">
            {users.map((u) => {
              const isSelf = u.id === user?.id;
              return (
                <div
                  key={u.id}
                  className="flex items-center justify-between gap-2 py-1.5 border-b border-border last:border-0"
                >
                  <div className="min-w-0 flex-1">
                    <p className="text-sm text-foreground truncate">
                      {u.full_name || u.email || 'Sin nombre'}
                    </p>
                    {u.full_name && u.email && (
                      <p className="text-[11px] text-muted-foreground truncate">{u.email}</p>
                    )}
                  </div>
                  <div className="flex-shrink-0 w-[130px]">
                    <Select
                      value={u.role ?? 'sin_rol'}
                      onValueChange={(v) => {
                        if (v !== 'sin_rol') handleRoleChange(u.id, v as AppRole);
                      }}
                      disabled={isSelf || updating === u.id}
                    >
                      <SelectTrigger className="h-8 text-xs">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="sin_rol" disabled>Sin rol</SelectItem>
                        <SelectItem value="admin">Administrador</SelectItem>
                        <SelectItem value="operator">Operador</SelectItem>
                        <SelectItem value="gabinete">Gabinete</SelectItem>
                        <SelectItem value="supervisor">Supervisor</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
