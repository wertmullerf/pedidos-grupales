import type { Branch } from '@pedido/shared';
import { ORDER_CODE_LENGTH } from '@pedido/shared';
import { useEffect, useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { BrandMark } from '../components/BrandMark';
import { api, ApiError } from '../lib/api';
import { saveIdentity } from '../lib/identity';
import { rejectionMessage } from '../lib/messages';
import { useTenant } from '../lib/tenant';
import styles from './TenantHome.module.css';

export function TenantHome() {
  const tenant = useTenant();
  const navigate = useNavigate();
  const [branches, setBranches] = useState<Branch[] | null>(null);
  const [branchId, setBranchId] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.branches(tenant.slug).then((list) => {
      setBranches(list);
      setBranchId(list.find((b) => b.isOpen)?.id ?? null);
    });
  }, [tenant.slug]);

  async function create(e: FormEvent) {
    e.preventDefault();
    if (!branchId || !name.trim()) return;
    setCreating(true);
    setError(null);
    try {
      const res = await api.createOrder(tenant.slug, branchId, name.trim());
      saveIdentity(tenant.slug, res.code, {
        token: res.token,
        participantId: res.participant.id,
        name: res.participant.name,
      });
      navigate(`/t/${tenant.slug}/o/${res.code}`);
    } catch (err) {
      setError(err instanceof ApiError ? rejectionMessage(err.code) : 'No pudimos crear el pedido');
      setCreating(false);
    }
  }

  function join(e: FormEvent) {
    e.preventDefault();
    const clean = code.trim().toUpperCase();
    if (clean.length === ORDER_CODE_LENGTH) navigate(`/t/${tenant.slug}/o/${clean}`);
  }

  return (
    <main className={styles.page}>
      <header className={styles.hero}>
        <BrandMark tenant={tenant} size={72} />
        <h1 className={styles.title}>{tenant.name}</h1>
        <p className={styles.subtitle}>
          Pedí en grupo: cada uno elige lo suyo y todos lo ven en vivo.
        </p>
      </header>

      <form className={`card ${styles.section}`} onSubmit={create}>
        <h2 className={styles.sectionTitle}>Armá un pedido grupal</h2>

        <fieldset className={styles.branches}>
          <legend className={styles.label}>¿A qué sucursal?</legend>
          {!branches && <div className={styles.skeleton} />}
          {branches?.map((b) => (
            <label
              key={b.id}
              className={`${styles.branch} ${branchId === b.id ? styles.branchActive : ''}`}
              data-closed={!b.isOpen || undefined}
            >
              <input
                type="radio"
                name="branch"
                value={b.id}
                checked={branchId === b.id}
                disabled={!b.isOpen}
                onChange={() => setBranchId(b.id)}
                className="visually-hidden"
              />
              <span className={styles.branchName}>{b.name}</span>
              <span className={styles.branchAddress}>{b.address}</span>
              {!b.isOpen && <span className={styles.closed}>Cerrada ahora</span>}
            </label>
          ))}
        </fieldset>

        <label className={styles.label} htmlFor="host-name">
          ¿Cómo te llamás?
        </label>
        <input
          id="host-name"
          className="input"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Tu nombre"
          maxLength={40}
          autoComplete="given-name"
        />
        {error && (
          <p className={styles.error} role="alert">
            {error}
          </p>
        )}
        <button
          className="btn btn-primary btn-block"
          disabled={!branchId || !name.trim() || creating}
        >
          {creating ? 'Creando…' : 'Crear pedido grupal'}
        </button>
      </form>

      <form className={`card ${styles.section}`} onSubmit={join}>
        <h2 className={styles.sectionTitle}>¿Te pasaron un código?</h2>
        <div className={styles.joinRow}>
          <input
            className={`input ${styles.codeInput}`}
            value={code}
            onChange={(e) => setCode(e.target.value.toUpperCase())}
            placeholder="ABC234"
            maxLength={ORDER_CODE_LENGTH}
            aria-label="Código del pedido"
            autoCapitalize="characters"
          />
          <button className="btn btn-secondary" disabled={code.trim().length !== ORDER_CODE_LENGTH}>
            Unirme
          </button>
        </div>
      </form>

      <a className={styles.back} href="/">
        ← Ver todas las cadenas de la demo
      </a>
    </main>
  );
}
