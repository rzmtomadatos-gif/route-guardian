import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Trash2, Plus, Loader2, Mail, ShieldCheck } from 'lucide-react';
import { toast } from 'sonner';

interface AllowedEmail {
  id: string;
  email: string;
  notes: string | null;
  added_at: string;
}

export function AllowedEmailsManager() {
  const [emails, setEmails] = useState<AllowedEmail[]>([]);
  const [loading, setLoading] = useState(true);
  const [newEmail, setNewEmail] = useState('');
  const [newNotes, setNewNotes] = useState('');
  const [adding, setAdding] = useState(false);

  const fetchEmails = async () => {
    const { data, error } = await supabase
      .from('allowed_emails')
      .select('*')
      .order('added_at', { ascending: true });
    if (error) {
      toast.error('Error cargando lista de emails autorizados');
    } else {
      setEmails(data || []);
    }
    setLoading(false);
  };

  useEffect(() => {
    fetchEmails();
  }, []);

  const handleAdd = async () => {
    const trimmed = newEmail.toLowerCase().trim();
    if (!trimmed || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) {
      toast.error('Introduce un email válido.');
      return;
    }
    setAdding(true);
    const { error } = await supabase
      .from('allowed_emails')
      .insert({ email: trimmed, notes: newNotes.trim() || null });
    setAdding(false);
    if (error) {
      if (error.code === '23505') {
        toast.error('Este email ya está en la lista.');
      } else {
        toast.error(error.message);
      }
    } else {
      toast.success(`${trimmed} añadido a la lista.`);
      setNewEmail('');
      setNewNotes('');
      fetchEmails();
    }
  };

  const handleDelete = async (id: string, email: string) => {
    const { error } = await supabase
      .from('allowed_emails')
      .delete()
      .eq('id', id);
    if (error) {
      toast.error(error.message);
    } else {
      toast.success(`${email} eliminado de la lista.`);
      setEmails((prev) => prev.filter((e) => e.id !== id));
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-4">
        <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 text-muted-foreground">
        <ShieldCheck className="w-4 h-4" />
        <span className="text-sm font-medium">Emails autorizados</span>
      </div>
      <div className="bg-card rounded-xl p-4 border border-border space-y-3">
        <p className="text-xs text-muted-foreground">
          Solo los emails en esta lista pueden registrarse en la aplicación.
        </p>

        {/* List */}
        <div className="space-y-1 max-h-48 overflow-y-auto">
          {emails.map((item) => (
            <div key={item.id} className="flex items-center justify-between gap-2 py-1.5 px-2 rounded-lg hover:bg-secondary/50 group">
              <div className="flex items-center gap-2 min-w-0">
                <Mail className="w-3.5 h-3.5 text-muted-foreground flex-shrink-0" />
                <div className="min-w-0">
                  <p className="text-sm text-foreground truncate">{item.email}</p>
                  {item.notes && <p className="text-xs text-muted-foreground truncate">{item.notes}</p>}
                </div>
              </div>
              <Button
                variant="ghost"
                size="sm"
                className="h-7 w-7 p-0 opacity-0 group-hover:opacity-100 text-destructive hover:text-destructive hover:bg-destructive/10"
                onClick={() => handleDelete(item.id, item.email)}
              >
                <Trash2 className="w-3.5 h-3.5" />
              </Button>
            </div>
          ))}
        </div>

        {/* Add form */}
        <div className="flex gap-2">
          <Input
            type="email"
            placeholder="nuevo@email.com"
            value={newEmail}
            onChange={(e) => setNewEmail(e.target.value)}
            className="flex-1 h-8 text-sm bg-secondary border-border"
          />
          <Input
            type="text"
            placeholder="Nota (opc.)"
            value={newNotes}
            onChange={(e) => setNewNotes(e.target.value)}
            className="w-28 h-8 text-sm bg-secondary border-border"
          />
          <Button
            onClick={handleAdd}
            disabled={adding || !newEmail}
            size="sm"
            className="h-8"
          >
            {adding ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
          </Button>
        </div>
      </div>
    </div>
  );
}
