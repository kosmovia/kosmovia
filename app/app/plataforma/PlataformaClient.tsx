'use client';

import React, { useState, useEffect, useCallback, useRef } from 'react';
import Link from 'next/link';
import { CommunityBar } from '../../components/CommunityBar';
import { ChannelList } from '../../components/ChannelList';
import { ChatArea } from '../../components/ChatArea';
import { MemberList } from '../../components/MemberList';
import { ProfileModal } from '../../components/ProfileModal';
import { WalletDrawer } from '../../components/WalletDrawer';
import { CreateChannelModal } from '../../components/CreateChannelModal';
import { QuickInvoiceModal } from '../../components/QuickInvoiceModal';
import { UserCard } from '../../components/UserCard';
import { NotificationsPanel } from '../../components/NotificationsPanel';
import { AppsPanel } from '../../components/AppsPanel';
import { CreateCommunityModal } from '../../components/CreateCommunityModal';
import { ChannelSettingsModal } from '../../components/ChannelSettingsModal';
import { THEME_STORAGE_KEY, isThemeId, type ThemeId } from '../../components/ThemePicker';
import { PaymentGuardProvider, usePaymentApproval } from '../../components/PaymentGuard';
import { CommunitySettingsModal } from '../../components/CommunitySettingsModal';
import { DmList } from '../../components/DmList';
import { sortChannels } from '../../components/channelUtils';
import type { UpdateChannelInput } from '../../services';
import { logoutThisDevice, syncThisDeviceSubscription } from '../../lib/core/push-client';
import { Channel, Community, DmThread, Message, User, WalletTransaction } from '../../types';
import {
  authService,
  communityService,
  chatService,
  dmService,
  walletService,
  INITIAL_USER,
  INITIAL_COMMUNITIES,
  INITIAL_MESSAGES,
  INITIAL_TRANSACTIONS,
  SERVICES_MODE,
} from '../../services';

/**
 * Junta la última página que devolvió el servidor con lo que ya se ve: refleja ediciones
 * y borrados de otras personas. Devuelve `current` (misma referencia) si nada cambió.
 * `keep`: ids enviados hace segundos que el servidor quizá aún no lista.
 */
function mergeLatest(current: Message[], page: Message[], isFullChannel: boolean, keep: Set<string>): Message[] {
  let next: Message[];
  if (isFullChannel) {
    next = page.slice();
    for (const m of current) if (keep.has(m.id) && !next.some((n) => n.id === m.id)) next.push(m);
  } else {
    const anchor = page.length > 0 ? current.findIndex((m) => m.id === page[0].id) : -1;
    if (anchor < 0) return current;
    next = current.slice(0, anchor).concat(page);
    for (const m of current.slice(anchor)) if (keep.has(m.id) && !next.some((n) => n.id === m.id)) next.push(m);
  }
  const same =
    next.length === current.length &&
    next.every((m, i) => m.id === current[i].id && m.content === current[i].content && m.editedAt === current[i].editedAt);
  return same ? current : next;
}

const TOAST_MS = 7000;

export function PlataformaPage() {
  return (
    <PaymentGuardProvider>
      <PlataformaContent />
    </PaymentGuardProvider>
  );
}

function PlataformaContent() {
  const requestApproval = usePaymentApproval();
  const [currentUser, setCurrentUser] = useState<User>(INITIAL_USER);
  const [communities, setCommunities] = useState<Community[]>(INITIAL_COMMUNITIES);
  const [activeCommunityId, setActiveCommunityId] = useState<string>('comm-1');
  const [activeChannelId, setActiveChannelId] = useState<string>('chan-1');
  const [messagesByChannel, setMessagesByChannel] = useState<Record<string, Message[]>>(INITIAL_MESSAGES);
  const [isMobileOpen, setIsMobileOpen] = useState<boolean>(false);
  // Panel derecho: Miembros, Mi Wallet o Notificaciones, uno a la vez y fijo (no tapa el chat).
  const [rightPanel, setRightPanel] = useState<'members' | 'wallet' | 'notifications' | 'apps' | null>('members');
  const togglePanel = (panel: 'members' | 'wallet' | 'notifications' | 'apps') =>
    setRightPanel((prev) => (prev === panel ? null : panel));
  const isMemberListOpen = rightPanel === 'members';
  // Abrir Aplicaciones directo en una vaquita (desde la tarjeta del chat); `nonce` reinicia el panel.
  const [appsTarget, setAppsTarget] = useState<{ vaquitaId: string; nonce: number } | null>(null);
  const [isProfileModalOpen, setIsProfileModalOpen] = useState<boolean>(false);

  // Tema: Kosmovia (azul noche con turquesa) o Negro. Se recuerda en este navegador.
  const [theme, setTheme] = useState<ThemeId>('kosmovia');
  useEffect(() => {
    try {
      const saved = window.localStorage.getItem(THEME_STORAGE_KEY);
      if (isThemeId(saved)) setTheme(saved);
    } catch {
      /* sin almacenamiento: queda el tema por defecto */
    }
  }, []);

  // Modales de creación de canal y cobro B2B
  const [isCreateChannelOpen, setIsCreateChannelOpen] = useState<boolean>(false);
  const [isQuickInvoiceOpen, setIsQuickInvoiceOpen] = useState<boolean>(false);

  // Estados de Billetera Stellar
  const isWalletOpen = rightPanel === 'wallet';
  const [balanceUSDC, setBalanceUSDC] = useState<number>(SERVICES_MODE === 'api' ? 0 : 185.0);
  const [balanceXLM, setBalanceXLM] = useState<number>(SERVICES_MODE === 'api' ? 0 : 42.8);
  const [publicKey, setPublicKey] = useState<string>('GD26UBYVEYYVVOVCMOLPMIKPWQRFV34LK3I7LHBNTUGYHYIKFMEREH2A');
  const [transactions, setTransactions] = useState<WalletTransaction[]>(SERVICES_MODE === 'api' ? [] : INITIAL_TRANSACTIONS);
  // Borrador de integración: estado visible del pago (antes solo iba a la consola).
  const [payNotice, setPayNotice] = useState<{ kind: 'info' | 'ok' | 'error'; text: string } | null>(null);
  // En modo api no se muestra nada hasta tener los datos reales (sin parpadeo de los de ejemplo).
  const [ready, setReady] = useState<boolean>(SERVICES_MODE !== 'api');
  const [loadError, setLoadError] = useState<string | null>(null);
  const [messageLoadError, setMessageLoadError] = useState<string | null>(null);
  const [messageRetry, setMessageRetry] = useState(0);
  // Tarjeta de perfil abierta (desde el chat o la lista de miembros) y "Transferir" a esa persona.
  const [profileCardUser, setProfileCardUser] = useState<User | null>(null);
  const [sendTo, setSendTo] = useState<{ recipient: string; nonce: number } | null>(null);
  // Saldo a mano (botón ↻) y notificaciones de pagos (revisa cada 20 s).
  const [isRefreshingWallet, setIsRefreshingWallet] = useState(false);
  const [lastSeenPayments, setLastSeenPayments] = useState<number>(0);
  const knownTxIds = useRef<Set<string> | null>(null);
  const [isCreateCommunityOpen, setIsCreateCommunityOpen] = useState(false);
  const [isCommunitySettingsOpen, setIsCommunitySettingsOpen] = useState(false);
  // Canal cuyo "Configurar canal" está abierto (null = cerrado).
  const [channelSettingsId, setChannelSettingsId] = useState<string | null>(null);
  // Categoría donde se creará el canal nuevo (la del "+" que se tocó).
  const [newChannelCategory, setNewChannelCategory] = useState<string | null>(null);
  // Mensajes directos: la columna del medio y el chat cambian a las conversaciones.
  const [view, setView] = useState<'community' | 'dms'>('community');
  const [dmThreads, setDmThreads] = useState<DmThread[]>([]);
  const [activeThreadId, setActiveThreadId] = useState<string | null>(null);
  const inDm = view === 'dms';
  const dmUnreadTotal = dmThreads.reduce((sum, t) => sum + (t.unread || 0), 0);

  // En pantallas chicas la lista de miembros arranca oculta (el chat necesita el espacio).
  useEffect(() => {
    if (typeof window !== 'undefined' && window.innerWidth < 1200) setRightPanel(null);
  }, []);
  // Los avisos desaparecen solos a los 7 s (se reinicia si llega otro). "Pagando…" espera al resultado (tope 30 s).
  useEffect(() => {
    if (!payNotice) return;
    const timer = setTimeout(() => setPayNotice(null), payNotice.kind === 'info' ? 30_000 : TOAST_MS);
    return () => clearTimeout(timer);
  }, [payNotice]);
  const recentlySent = useRef<Map<string, number>>(new Map());
  const errorText = (err: unknown, fallback: string) => (err instanceof Error && err.message ? err.message : fallback);

  // Sincronizar tema con atributo en documentElement
  useEffect(() => {
    if (typeof document !== 'undefined') {
      document.documentElement.setAttribute('data-theme', theme);
    }
  }, [theme]);

  // Carga inicial desacoplada desde la capa de servicios
  useEffect(() => {
    let isMounted = true;

    async function loadInitialData() {
      try {
        // La wallet puede estar temporalmente caída sin impedir usar las comunidades.
        const walletData = Promise.allSettled([
          walletService.getPublicKey(),
          walletService.getBalances(''),
          walletService.getTransactions(''),
        ]);
        let [user, comms] = await Promise.all([
          authService.getCurrentUser(),
          communityService.getCommunities(),
        ]);

        if (!isMounted) return;

        // Link de invitación: /plataforma?c=<slug> te une y abre esa comunidad.
        const invited = new URLSearchParams(window.location.search).get('c');
        let invitedTarget = invited ? comms.find((c) => c.slug === invited) : undefined;
        if (invited && !invitedTarget && communityService.joinBySlug) {
          try {
            await communityService.joinBySlug(invited);
            comms = await communityService.getCommunities();
            invitedTarget = comms.find((c) => c.slug === invited);
            if (invitedTarget) setPayNotice({ kind: 'ok', text: `Te uniste a ${invitedTarget.name}.` });
          } catch (err) {
            setPayNotice({ kind: 'error', text: errorText(err, 'No pudimos unirte a esa comunidad.') });
          }
        }
        if (invitedTarget) {
          setActiveCommunityId(invitedTarget.id);
          if (invitedTarget.channels.length > 0) setActiveChannelId(invitedTarget.channels[0].id);
          const remaining = new URL(window.location.href);
          remaining.searchParams.delete('c');
          window.history.replaceState(null, '', remaining.pathname + remaining.search);
        }

        setCurrentUser(user);
        setCommunities(comms);
        setPublicKey(user.wallet ?? '');

        if (!invitedTarget && comms.length > 0 && !comms.some((c) => c.id === activeCommunityId)) {
          setActiveCommunityId(comms[0].id);
          if (comms[0].channels.length > 0) {
            setActiveChannelId(comms[0].channels[0].id);
          }
        }
        setReady(true);
        const [pkResult, balanceResult, txResult] = await walletData;
        if (!isMounted) return;
        if (pkResult.status === 'fulfilled') setPublicKey(pkResult.value);
        if (balanceResult.status === 'fulfilled') {
          setBalanceUSDC(balanceResult.value.usdc);
          setBalanceXLM(balanceResult.value.xlm);
        }
        if (txResult.status === 'fulfilled') setTransactions(txResult.value);
        if ([pkResult, balanceResult, txResult].some((result) => result.status === 'rejected')) {
          setPayNotice({ kind: 'error', text: 'No se pudo actualizar la wallet. Puedes seguir chateando y reintentar desde Mi Wallet.' });
        }
      } catch (err) {
        console.error('[PlataformaPage] Error loading initial service data:', err);
        if (isMounted) setLoadError(errorText(err, 'No se pudieron cargar tus datos.'));
      }
    }

    loadInitialData();

    return () => {
      isMounted = false;
    };
  }, []);

  // Vincula este dispositivo a la sesión actual sin pedir permisos automáticamente.
  useEffect(() => {
    if (ready && SERVICES_MODE === 'api') void syncThisDeviceSubscription(currentUser.id).catch(() => {});
  }, [ready, currentUser.id]);

  // Los avisos abren el chat exacto; solo destinos accesibles al usuario.
  useEffect(() => {
    if (!ready) return;
    const params = new URLSearchParams(window.location.search);
    const dm = params.get('dm');
    const channel = params.get('channel');
    const wallet = params.get('panel') === 'wallet';
    if (!dm && !channel && !wallet) return;
    let alive = true;
    const consume = () => {
      const url = new URL(window.location.href);
      for (const key of ['dm', 'channel', 'panel']) url.searchParams.delete(key);
      window.history.replaceState(null, '', url.pathname + url.search);
    };
    if (wallet) setRightPanel('wallet');
    if (channel && !dm) {
      const community = communities.find((c) => c.channels.some((ch) => ch.id === channel));
      if (community) {
        setView('community');
        setActiveCommunityId(community.id);
        setActiveChannelId(channel);
      } else setPayNotice({ kind: 'error', text: 'Ese canal ya no está disponible para tu cuenta.' });
      consume();
    } else if (dm) {
      void dmService.getThreads().then((threads) => {
        if (!alive) return;
        setDmThreads(threads);
        if (threads.some((thread) => thread.id === dm)) {
          setView('dms');
          setActiveThreadId(dm);
        } else setPayNotice({ kind: 'error', text: 'Esa conversación ya no está disponible para tu cuenta.' });
        consume();
      }).catch(() => {
        if (alive) setPayNotice({ kind: 'error', text: 'No se pudo abrir la conversación del aviso. Reintenta al recargar.' });
      });
    } else consume();
    return () => { alive = false; };
  }, [ready, communities]);

  const seenKey = `kosmovia:pagos-vistos:${publicKey}`;
  useEffect(() => {
    // Primera vez en este navegador: se cuenta desde ahora (el historial viejo no es "nuevo").
    try {
      const stored = Number(localStorage.getItem(seenKey));
      if (stored) setLastSeenPayments(stored);
      else {
        const now = Date.now();
        localStorage.setItem(seenKey, String(now));
        setLastSeenPayments(now);
      }
    } catch {
      setLastSeenPayments(Date.now());
    }
  }, [seenKey]);

  /** Trae saldo e historial; avisa si llegó dinero nuevo. `silent`: sin el giro del botón. */
  const refreshWallet = useCallback(
    async (silent = false) => {
      if (SERVICES_MODE !== 'api') return;
      if (!silent) setIsRefreshingWallet(true);
      try {
        const [balances, txs] = await Promise.all([
          walletService.getBalances(publicKey),
          walletService.getTransactions(publicKey),
        ]);
        setBalanceUSDC(balances.usdc);
        setBalanceXLM(balances.xlm);
        setTransactions(txs);
        const known = knownTxIds.current;
        if (known) {
          const incoming = txs.filter((t) => t.type === 'received' && !known.has(t.id));
          if (incoming.length > 0) {
            const t = incoming[0];
            setPayNotice({ kind: 'ok', text: `💸 Recibiste ${t.amount} ${t.asset} de ${t.counterparty}.` });
          }
        }
        knownTxIds.current = new Set(txs.map((t) => t.id));
      } catch (err) {
        if (!silent) setPayNotice({ kind: 'error', text: errorText(err, 'No se pudo actualizar el saldo.') });
      } finally {
        if (!silent) setIsRefreshingWallet(false);
      }
    },
    [publicKey]
  );

  useEffect(() => {
    if (!ready || SERVICES_MODE !== 'api') return;
    knownTxIds.current = new Set(transactions.map((t) => t.id));
    const timer = setInterval(() => void refreshWallet(true), 20_000);
    return () => clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, refreshWallet]);

  const unreadPayments = transactions.filter((t) => t.paidAt && Date.parse(t.paidAt) > lastSeenPayments).length;
  const markPaymentsSeen = () => {
    const now = Date.now();
    setLastSeenPayments(now);
    try {
      localStorage.setItem(seenKey, String(now));
    } catch {
      // Sin almacenamiento: el número vuelve a aparecer al recargar.
    }
  };

  // Al abrir la billetera: saldo e historial al día (también los pagos que te llegaron).
  useEffect(() => {
    if (!isWalletOpen || SERVICES_MODE !== 'api') return;
    let isMounted = true;
    Promise.all([walletService.getBalances(publicKey), walletService.getTransactions(publicKey)])
      .then(([balances, txs]) => {
        if (!isMounted) return;
        setBalanceUSDC(balances.usdc);
        setBalanceXLM(balances.xlm);
        setTransactions(txs);
      })
      .catch(() => {});
    return () => {
      isMounted = false;
    };
  }, [isWalletOpen, publicKey]);

  // Conversaciones: se revisan cada 10 s (insignia de no leídos del riel). Solo en modo api (el demo no tiene otra persona).
  const refreshThreads = useCallback(async () => {
    try {
      const threads = await dmService.getThreads();
      setDmThreads(threads);
    } catch {
      /* se reintenta en el próximo ciclo */
    }
  }, []);
  useEffect(() => {
    if (!ready) return;
    void refreshThreads();
    if (SERVICES_MODE !== 'api') return;
    const timer = setInterval(() => void refreshThreads(), 10_000);
    return () => clearInterval(timer);
  }, [ready, refreshThreads]);

  // Id del chat abierto (canal o conversación) y su servicio: los dos comparten la forma de los mensajes.
  const chatId = inDm ? activeThreadId : activeChannelId;
  const msgSvc = inDm ? dmService : chatService;

  // Suscripción en tiempo real y carga de mensajes por canal (o conversación) activo
  useEffect(() => {
    if (!ready || !chatId) return;
    setMessageLoadError(null);
    const activeChannelId = chatId;
    let isMounted = true;

    msgSvc.getMessages(activeChannelId).then((msgs) => {
      if (!isMounted) return;
      setMessagesByChannel((prev) => ({
        ...prev,
        [activeChannelId]: msgs,
      }));
      if (inDm) void refreshThreads(); // abrirla la marca como leída
    }).catch((err) => {
      if (isMounted) setMessageLoadError(errorText(err, 'No se pudieron cargar los mensajes.'));
    });

    const unsubscribe = msgSvc.subscribeToMessages(
      activeChannelId,
      (incomingMsg) => {
        if (!isMounted) return;
        setMessagesByChannel((prev) => {
          const current = prev[activeChannelId] || [];
          if (current.some((m) => m.id === incomingMsg.id)) {
            return prev;
          }
          return {
            ...prev,
            [activeChannelId]: [...current, incomingMsg],
          };
        });
      },
      // Ediciones y borrados de otras personas.
      (latestPage, isFullChannel) => {
        if (!isMounted) return;
        const now = Date.now();
        const keep = new Set<string>();
        recentlySent.current.forEach((at, id) => (now - at < 8000 ? keep.add(id) : recentlySent.current.delete(id)));
        setMessagesByChannel((prev) => {
          const current = prev[activeChannelId] || [];
          const merged = mergeLatest(current, latestPage, isFullChannel, keep);
          return merged === current ? prev : { ...prev, [activeChannelId]: merged };
        });
      },
    );

    return () => {
      isMounted = false;
      unsubscribe();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chatId, inDm, ready, messageRetry]);

  const handleChangeTheme = (next: ThemeId) => {
    setTheme(next);
    try {
      window.localStorage.setItem(THEME_STORAGE_KEY, next);
    } catch {
      /* sin almacenamiento: el cambio vale solo en esta sesión */
    }
  };

  const activeCommunity = communities.find((c) => c.id === activeCommunityId) || communities[0];
  const activeChannel = activeCommunity.channels.find((ch) => ch.id === activeChannelId) || activeCommunity.channels[0];

  const handleSelectCommunity = (communityId: string) => {
    setView('community');
    setActiveCommunityId(communityId);
    const targetCommunity = communities.find((c) => c.id === communityId);
    if (targetCommunity && targetCommunity.channels.length > 0) {
      setActiveChannelId(targetCommunity.channels[0].id);
    }
  };

  const handleSelectChannel = (channelId: string) => {
    setActiveChannelId(channelId);
    setIsMobileOpen(false);
  };

  /** Los avisos de error del servidor traen códigos: se muestran en español. */
  const friendlyError = (err: unknown, fallback: string) => {
    const text = errorText(err, fallback);
    return text.includes('no_shared_community') ? 'Solo puedes escribirle a quien comparte una comunidad contigo.' : text;
  };

  /** Publica en el chat abierto. Devuelve el id del mensaje, o null si no se pudo (el error ya se avisó). */
  const postToActiveChat = async (text: string): Promise<string | null> => {
    if (!text.trim() || !chatId) return null;
    const targetId = chatId;

    try {
      const sentMsg = await msgSvc.sendMessage(targetId, text, currentUser);
      recentlySent.current.set(sentMsg.id, Date.now());
      setMessagesByChannel((prev) => {
        const current = prev[targetId] || [];
        if (current.some((m) => m.id === sentMsg.id)) return prev;
        return {
          ...prev,
          [targetId]: [...current, sentMsg],
        };
      });
      if (inDm) void refreshThreads();
      return sentMsg.id;
    } catch (err) {
      console.error('[PlataformaPage] Error sending message:', err);
      setPayNotice({ kind: 'error', text: errorText(err, 'No se pudo enviar el mensaje.') });
      return null;
    }
  };

  const handleSendMessage = async (text: string): Promise<boolean> => {
    return Boolean(await postToActiveChat(text));
  };

  const handleEditMessage = async (messageId: string, content: string): Promise<boolean> => {
    const channelId = chatId;
    if (!channelId) return false;
    try {
      const updated = await msgSvc.editMessage(channelId, messageId, content);
      setMessagesByChannel((prev) => ({
        ...prev,
        [channelId]: (prev[channelId] || []).map((m) => (m.id === messageId ? { ...m, content: updated.content, editedAt: updated.editedAt ?? new Date().toISOString() } : m)),
      }));
      return true;
    } catch (err) {
      setPayNotice({ kind: 'error', text: errorText(err, 'No se pudo editar el mensaje.') });
      return false;
    }
  };

  const handleDeleteMessage = async (messageId: string): Promise<boolean> => {
    const channelId = chatId;
    if (!channelId) return false;
    try {
      await msgSvc.deleteMessage(channelId, messageId);
      setMessagesByChannel((prev) => ({ ...prev, [channelId]: (prev[channelId] || []).filter((m) => m.id !== messageId) }));
      return true;
    } catch (err) {
      setPayNotice({ kind: 'error', text: errorText(err, 'No se pudo borrar el mensaje.') });
      return false;
    }
  };

  const handleSaveChannelTopic = async (channelId: string, topic: string): Promise<boolean> => {
    try {
      const updated = await communityService.updateChannelTopic(activeCommunity.id, channelId, topic);
      setCommunities((prev) =>
        prev.map((c) =>
          c.id === activeCommunity.id
            ? { ...c, channels: c.channels.map((ch) => (ch.id === channelId ? { ...ch, topic: updated.topic } : ch)) }
            : c
        )
      );
      setPayNotice({ kind: 'ok', text: 'Descripción del canal guardada.' });
      return true;
    } catch (err) {
      setPayNotice({ kind: 'error', text: errorText(err, 'No se pudo guardar la descripción.') });
      return false;
    }
  };

  const handleUpdateChannel = async (channelId: string, patch: UpdateChannelInput): Promise<boolean> => {
    try {
      const updated = await communityService.updateChannel(activeCommunity.id, channelId, patch);
      setCommunities((prev) =>
        prev.map((c) =>
          c.id === activeCommunity.id
            ? { ...c, channels: c.channels.map((ch) => (ch.id === channelId ? { ...ch, ...updated } : ch)) }
            : c
        )
      );
      return true;
    } catch (err) {
      setPayNotice({ kind: 'error', text: errorText(err, 'No se pudo guardar el canal.') });
      return false;
    }
  };

  /** Sube o baja un canal: reasigna posiciones dentro de su categoría (0..n) y guarda las que cambian. */
  const handleMoveChannel = async (channelId: string, dir: -1 | 1): Promise<boolean> => {
    const ch = activeCommunity.channels.find((x) => x.id === channelId);
    if (!ch) return false;
    const siblings = sortChannels(activeCommunity.channels.filter((x) => (x.categoryId ?? null) === (ch.categoryId ?? null)));
    const i = siblings.findIndex((x) => x.id === channelId);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= siblings.length) return false;
    const reordered = siblings.slice();
    [reordered[i], reordered[j]] = [reordered[j], reordered[i]];
    try {
      const changed = reordered.map((x, idx) => ({ x, idx })).filter(({ x, idx }) => x.position !== idx);
      await Promise.all(changed.map(({ x, idx }) => communityService.updateChannel(activeCommunity.id, x.id, { position: idx })));
      const pos = new Map(changed.map(({ x, idx }) => [x.id, idx] as const));
      setCommunities((prev) =>
        prev.map((c) =>
          c.id === activeCommunity.id
            ? { ...c, channels: c.channels.map((x) => (pos.has(x.id) ? { ...x, position: pos.get(x.id) } : x)) }
            : c
        )
      );
      return true;
    } catch (err) {
      setPayNotice({ kind: 'error', text: errorText(err, 'No se pudo reordenar el canal.') });
      return false;
    }
  };

  const handleCreateCategory = async (name: string): Promise<boolean> => {
    try {
      const category = await communityService.createCategory(activeCommunity.id, name);
      setCommunities((prev) =>
        prev.map((c) => (c.id === activeCommunity.id ? { ...c, categories: [...(c.categories ?? []), category] } : c))
      );
      return true;
    } catch (err) {
      setPayNotice({ kind: 'error', text: errorText(err, 'No se pudo crear la categoría.') });
      return false;
    }
  };

  const handleRenameCategory = async (categoryId: string, name: string): Promise<boolean> => {
    try {
      const updated = await communityService.updateCategory(activeCommunity.id, categoryId, { name });
      setCommunities((prev) =>
        prev.map((c) =>
          c.id === activeCommunity.id ? { ...c, categories: (c.categories ?? []).map((k) => (k.id === categoryId ? updated : k)) } : c
        )
      );
      return true;
    } catch (err) {
      setPayNotice({ kind: 'error', text: errorText(err, 'No se pudo renombrar la categoría.') });
      return false;
    }
  };

  const handleMoveCategory = async (categoryId: string, dir: -1 | 1): Promise<boolean> => {
    const sorted = (activeCommunity.categories ?? []).slice().sort((a, b) => a.position - b.position);
    const i = sorted.findIndex((k) => k.id === categoryId);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= sorted.length) return false;
    const reordered = sorted.slice();
    [reordered[i], reordered[j]] = [reordered[j], reordered[i]];
    try {
      const changed = reordered.map((k, idx) => ({ k, idx })).filter(({ k, idx }) => k.position !== idx);
      await Promise.all(changed.map(({ k, idx }) => communityService.updateCategory(activeCommunity.id, k.id, { position: idx })));
      const pos = new Map(changed.map(({ k, idx }) => [k.id, idx] as const));
      setCommunities((prev) =>
        prev.map((c) =>
          c.id === activeCommunity.id
            ? { ...c, categories: (c.categories ?? []).map((k) => (pos.has(k.id) ? { ...k, position: pos.get(k.id)! } : k)) }
            : c
        )
      );
      return true;
    } catch (err) {
      setPayNotice({ kind: 'error', text: errorText(err, 'No se pudo reordenar la categoría.') });
      return false;
    }
  };

  const handleDeleteCategory = async (categoryId: string): Promise<boolean> => {
    try {
      await communityService.deleteCategory(activeCommunity.id, categoryId);
      setCommunities((prev) =>
        prev.map((c) =>
          c.id === activeCommunity.id
            ? {
                ...c,
                categories: (c.categories ?? []).filter((k) => k.id !== categoryId),
                channels: c.channels.map((ch) => (ch.categoryId === categoryId ? { ...ch, categoryId: null } : ch)),
              }
            : c
        )
      );
      return true;
    } catch (err) {
      setPayNotice({ kind: 'error', text: errorText(err, 'No se pudo borrar la categoría.') });
      return false;
    }
  };

  const handleCreateChannel = async (
    name: string,
    topic: string,
    extra: { emoji: string | null; categoryId: string | null; visibility: 'public' | 'private' }
  ): Promise<boolean> => {
    try {
      const newChannel = await communityService.createChannel(activeCommunity.id, {
        name,
        topic: topic || undefined,
        type: 'text',
        emoji: extra.emoji,
        categoryId: extra.categoryId,
        visibility: extra.visibility,
      });

      setCommunities((prev) =>
        prev.map((c) =>
          c.id === activeCommunity.id
            ? { ...c, channels: [...c.channels, newChannel] }
            : c
        )
      );

      setActiveChannelId(newChannel.id);

      await chatService.sendMessage(
        newChannel.id,
        `🎉 Canal #${name} creado con éxito. ¡Inicia la conversación!`,
        currentUser
      );
      return true;
    } catch (err) {
      console.error('[PlataformaPage] Error creating channel:', err);
      setPayNotice({ kind: 'error', text: errorText(err, 'No se pudo crear el canal.') });
      return false;
    }
  };

  const handleCreateCommunity = async (input: { name: string; slug: string; description: string; image?: string }): Promise<boolean> => {
    try {
      const created = await communityService.createCommunity({ ...input, icon: '' });
      setCommunities((prev) => [...prev, created]);
      setActiveCommunityId(created.id);
      if (created.channels.length > 0) setActiveChannelId(created.channels[0].id);
      setPayNotice({ kind: 'ok', text: `Comunidad ${created.name} creada.` });
      return true;
    } catch (err) {
      setPayNotice({ kind: 'error', text: errorText(err, 'No se pudo crear la comunidad.') });
      return false;
    }
  };

  const handleSaveCommunityImage = async (image: string | null): Promise<boolean> => {
    try {
      const updated = await communityService.updateImage(activeCommunity.id, image);
      setCommunities((prev) => prev.map((c) => (c.id === updated.id ? { ...c, image: updated.image } : c)));
      setPayNotice({ kind: 'ok', text: 'Foto de la comunidad actualizada.' });
      return true;
    } catch (err) {
      setPayNotice({ kind: 'error', text: errorText(err, 'No se pudo guardar la foto.') });
      return false;
    }
  };

  const handleSaveCommunityDescription = async (description: string): Promise<boolean> => {
    try {
      const updated = await communityService.updateDescription(activeCommunity.id, description);
      setCommunities((prev) => prev.map((c) => (c.id === updated.id ? { ...c, description: updated.description } : c)));
      setPayNotice({ kind: 'ok', text: 'Descripción de la comunidad guardada.' });
      return true;
    } catch (err) {
      setPayNotice({ kind: 'error', text: errorText(err, 'No se pudo guardar la descripción.') });
      return false;
    }
  };

  const handleChangeRole = async (profileId: string, role: 'admin' | 'moderator' | 'member'): Promise<boolean> => {
    if (!communityService.setMemberRole) return false;
    try {
      const updated = await communityService.setMemberRole(activeCommunity.id, profileId, role);
      setCommunities((prev) =>
        prev.map((c) =>
          c.id === activeCommunity.id
            ? { ...c, members: c.members.map((m) => (m.id === profileId ? { ...m, role: updated.role } : m)) }
            : c
        )
      );
      setPayNotice({ kind: 'ok', text: `${updated.username} ahora es ${role === 'admin' ? 'admin' : role === 'moderator' ? 'moderador' : 'miembro'}.` });
      return true;
    } catch (err) {
      setPayNotice({ kind: 'error', text: errorText(err, 'No se pudo cambiar el rol.') });
      return false;
    }
  };

  const handleDeleteChannel = async (channelId: string): Promise<boolean> => {
    if (!communityService.deleteChannel) return false;
    try {
      await communityService.deleteChannel(activeCommunity.id, channelId);
      const remaining = activeCommunity.channels.filter((ch) => ch.id !== channelId);
      setCommunities((prev) => prev.map((c) => (c.id === activeCommunity.id ? { ...c, channels: remaining } : c)));
      if (activeChannelId === channelId && remaining.length > 0) setActiveChannelId(remaining[0].id);
      setPayNotice({ kind: 'ok', text: 'Canal borrado.' });
      return true;
    } catch (err) {
      setPayNotice({ kind: 'error', text: errorText(err, 'No se pudo borrar el canal.') });
      return false;
    }
  };

  const handleDeleteCommunity = async (): Promise<boolean> => {
    if (!communityService.deleteCommunity) return false;
    const gone = activeCommunity;
    try {
      await communityService.deleteCommunity(gone.id);
      const rest = communities.filter((c) => c.id !== gone.id);
      if (rest.length === 0) {
        // Sin comunidades la UI no tiene qué mostrar: se recarga y el servicio te une a otra o crea "Kosmovia".
        window.location.reload();
        return true;
      }
      setCommunities(rest);
      setActiveCommunityId(rest[0].id);
      if (rest[0].channels.length > 0) setActiveChannelId(rest[0].channels[0].id);
      setPayNotice({ kind: 'ok', text: `${gone.name} fue borrada.` });
      return true;
    } catch (err) {
      setPayNotice({ kind: 'error', text: errorText(err, 'No se pudo borrar la comunidad.') });
      return false;
    }
  };

  /** Cierra la sesión de Pollar y la cookie de core, y vuelve al login. */
  const handleLogout = async () => {
    try {
      const client = (globalThis as { __kosmoviaPollarClient?: { logout: () => unknown } }).__kosmoviaPollarClient;
      await logoutThisDevice();
      await Promise.resolve(client?.logout());
    } finally {
      window.location.href = '/login';
    }
  };

  /** Canal de comprobantes (#verificacion-pagos) de la comunidad; sin él (demo) se usa el canal actual. */
  const receiptChannelId = () => activeCommunity.channels.find((ch) => ch.type === 'payments')?.id ?? activeChannel.id;

  /** @usuario si se conoce a quién se pagó (por @usuario o por su wallet G…); si no, la dirección corta. */
  const recipientLabel = (to: string) => {
    const raw = to.trim();
    if (raw.startsWith('#')) return raw;
    const byWallet = activeCommunity.members.find((m) => m.wallet && m.wallet === raw.toUpperCase());
    if (byWallet) return byWallet.username;
    if (/^G[A-Z2-7]{55}$/i.test(raw)) return `${raw.slice(0, 6)}…${raw.slice(-4)}`;
    return raw.startsWith('@') ? raw : `@${raw}`;
  };

  /** Los cobros se publican en #cobros (donde también se pagan); sin ese canal, en el actual. */
  const handleCreateInvoice = async (amount: number, concept: string) => {
    const payload = JSON.stringify({ amount, concept });
    const cobros = activeCommunity.channels.find((ch) => ch.name === 'cobros' && ch.type === 'text');
    if (!cobros || cobros.id === activeChannel.id) {
      void handleSendMessage(`[COBRO_B2B:${payload}]`);
      return;
    }
    try {
      const sent = await chatService.sendMessage(cobros.id, `[COBRO_B2B:${payload}]`, currentUser);
      recentlySent.current.set(sent.id, Date.now());
      setMessagesByChannel((prev) => ({ ...prev, [cobros.id]: [...(prev[cobros.id] || []), sent] }));
      setActiveChannelId(cobros.id);
      setPayNotice({ kind: 'ok', text: 'Cobro publicado en #cobros.' });
    } catch (err) {
      setPayNotice({ kind: 'error', text: errorText(err, 'No se pudo publicar el cobro.') });
    }
  };

  /** Paga un cobro B2B a quien lo emitió (el autor del mensaje con la tarjeta). */
  const handlePayInvoice = async (amount: number, concept: string, payee: string): Promise<boolean> => {
    const payTo = SERVICES_MODE === 'api' ? payee : `#${activeChannel.name}`;
    setPayNotice(null);
    const approval = await requestApproval({ to: payTo, toLabel: recipientLabel(payee), asset: 'USDC', amount });
    if (!approval) {
      setPayNotice({ kind: 'info', text: 'Pago cancelado.' });
      return false;
    }
    setPayNotice({ kind: 'info', text: `Pagando ${amount} USDC a ${payee}… (si usas Freighter, confirma ahí)` });
    try {
      // 1. Ejecutar pago no-custodia con servicio de wallet
      const newTx = await walletService.sendPayment({
        to: payTo,
        amount,
        asset: 'USDC',
        approval,
      });
      setTransactions((prev) => [newTx, ...prev]);

      const balances = await walletService.getBalances(publicKey);
      setBalanceUSDC(balances.usdc);

      // 2. Confirmar en #verificacion-pagos (o en el canal actual si no existe, como en el demo)
      await chatService.sendMessage(
        receiptChannelId(),
        `✅ Cobro pagado: ${amount} USDC a ${recipientLabel(payee)} por "${concept}". Verificado en Stellar testnet.`,
        currentUser
        // El pago ya salió: si el canal no deja escribir (p. ej. #anuncios para miembros), no es un error del pago.
      ).catch(() => {});
      setPayNotice({ kind: 'ok', text: `Cobro pagado: ${amount} USDC a ${payee}.` });
      return true;
    } catch (err) {
      console.error('[PlataformaPage] Error paying invoice:', err);
      setPayNotice({ kind: 'error', text: errorText(err, 'No se pudo pagar el cobro.') });
      return false;
    }
  };

  const handleUpdateProfile = async (updated: { displayName: string; bio: string }): Promise<boolean> => {
    try {
      const user = await authService.updateProfile(updated);
      setCurrentUser(user);
      return true;
    } catch (err) {
      console.error('[PlataformaPage] Error updating profile:', err);
      setPayNotice({ kind: 'error', text: errorText(err, 'No se pudo guardar tu perfil.') });
      return false;
    }
  };

  const handleSendPayment = async (to: string, amount: number, asset: 'USDC' | 'XLM'): Promise<boolean> => {
    setPayNotice(null);
    const approval = await requestApproval({ to, toLabel: recipientLabel(to), asset, amount });
    if (!approval) {
      setPayNotice({ kind: 'info', text: 'Pago cancelado.' });
      return false;
    }
    setPayNotice({ kind: 'info', text: `Enviando ${amount} ${asset} a ${to}… (si usas Freighter, confirma ahí)` });
    try {
      const newTx = await walletService.sendPayment({
        to,
        amount,
        asset,
        approval,
      });
      setTransactions((prev) => [newTx, ...prev]);

      const balances = await walletService.getBalances(publicKey);
      setBalanceUSDC(balances.usdc);
      setBalanceXLM(balances.xlm);

      setPayNotice({ kind: 'ok', text: `Pago enviado: ${amount} ${asset} a ${to}.` });
      await chatService.sendMessage(
        receiptChannelId(),
        `💸 He transferido ${amount} ${asset} a ${recipientLabel(to)} mediante Stellar Testnet (Tx verificada).`,
        currentUser
      ).catch(() => {});
      return true;
    } catch (err) {
      console.error('[PlataformaPage] Error sending payment:', err);
      setPayNotice({ kind: 'error', text: errorText(err, 'No se pudo enviar el pago.') });
      return false;
    }
  };

  const currentMembers = (activeCommunity.members || []).map((m) =>
    m.id === currentUser.id ? { ...m, ...currentUser, role: m.role ?? currentUser.role } : m
  );

  const myCommunityRole = currentMembers.find((m) => m.id === currentUser.id)?.role;
  // Configurar: dueño o admin (en modo demo, todos).
  const isCommunityOwner = SERVICES_MODE !== 'api' || myCommunityRole === 'owner' || myCommunityRole === 'admin';
  // En #anuncios solo escriben dueño y admin; moderadores y dueño/admin pueden borrar mensajes ajenos.
  const canPostHere = inDm || (activeChannel.type === 'payments' ? false : activeChannel.type !== 'announcement' || isCommunityOwner);

  const activeThread = dmThreads.find((t) => t.id === activeThreadId) ?? null;
  // En una conversación el "canal" que ve ChatArea es un envoltorio con el nombre de la otra persona.
  const chatChannel: Channel =
    inDm && activeThread
      ? { id: activeThread.id, communityId: '', name: activeThread.other.displayName, type: 'text' }
      : activeChannel;

  const handleOpenDms = () => {
    setView('dms');
    setIsMobileOpen(false);
    void refreshThreads();
  };

  const handleSelectThread = (threadId: string) => {
    setActiveThreadId(threadId);
    setIsMobileOpen(false);
    setDmThreads((prev) => prev.map((t) => (t.id === threadId ? { ...t, unread: 0 } : t)));
  };

  /** Abre (o crea) la conversación con @usuario y cambia a Mensajes directos. */
  const handleStartDm = async (username: string) => {
    try {
      const thread = await dmService.openThread(username);
      setDmThreads((prev) => (prev.some((t) => t.id === thread.id) ? prev : [thread, ...prev]));
      setProfileCardUser(null);
      setActiveThreadId(thread.id);
      setView('dms');
    } catch (err) {
      setPayNotice({ kind: 'error', text: friendlyError(err, 'No se pudo abrir la conversación.') });
    }
  };
  const canModerate = isCommunityOwner || myCommunityRole === 'moderator';

  if (!ready) {
    return (
      <div className="login-page-container">
        <div className="login-box" role={loadError ? 'alert' : 'status'}>
          <p className="login-subtitle">{loadError ?? 'Cargando tus comunidades y tu billetera…'}</p>
          {loadError ? (
            <button type="button" className="btn-login-submit" onClick={() => window.location.reload()}>
              Reintentar
            </button>
          ) : null}
        </div>
      </div>
    );
  }

  return (
    <div className={`app-container ${isMobileOpen ? 'mobile-open' : ''} ${rightPanel ? 'kv-has-panel' : ''}`}>
      <div
        className="mobile-backdrop"
        onClick={() => setIsMobileOpen(false)}
        aria-hidden="true"
      />

      <CommunityBar
        communities={communities}
        activeCommunityId={activeCommunity.id}
        onSelectCommunity={handleSelectCommunity}
        onCreateCommunity={() => setIsCreateCommunityOpen(true)}
        theme={theme}
        onChangeTheme={handleChangeTheme}
        onOpenDms={handleOpenDms}
        isDmsActive={inDm}
        dmUnread={dmUnreadTotal}
        onOpenApps={() => {
          setAppsTarget(null);
          togglePanel('apps');
        }}
        isAppsOpen={rightPanel === 'apps'}
      />

      {inDm ? (
        <DmList
          threads={dmThreads}
          activeThreadId={activeThread?.id ?? null}
          onSelectThread={handleSelectThread}
          currentUser={currentUser}
          onOpenProfile={() => setIsProfileModalOpen(true)}
        />
      ) : (
        <ChannelList
          community={activeCommunity}
          activeChannelId={activeChannel.id}
          onSelectChannel={handleSelectChannel}
          currentUser={currentUser}
          onOpenProfile={() => setIsProfileModalOpen(true)}
          onOpenCreateChannel={(categoryId) => {
            setNewChannelCategory(categoryId ?? null);
            setIsCreateChannelOpen(true);
          }}
          isOwner={isCommunityOwner}
          onOpenSettings={() => setIsCommunitySettingsOpen(true)}
          onOpenChannelSettings={setChannelSettingsId}
          onNotice={(text) => setPayNotice({ kind: 'ok', text })}
        />
      )}

      <ChatArea
        channel={chatChannel}
        variant={inDm ? 'dm' : 'channel'}
        dmPeer={inDm ? activeThread?.other : undefined}
        community={activeCommunity}
        messages={chatId ? messagesByChannel[chatId] || [] : []}
        onSendMessage={handleSendMessage}
        attachmentTarget={chatId ? { scope: inDm ? 'dm' : 'channel', id: chatId } : undefined}
        messageLoadError={messageLoadError}
        onRetryMessages={() => setMessageRetry((n) => n + 1)}
        onToggleMobileMenu={() => setIsMobileOpen((prev) => !prev)}
        onToggleMemberList={inDm ? undefined : () => togglePanel('members')}
        isMemberListOpen={isMemberListOpen && !inDm}
        onOpenWallet={() => togglePanel('wallet')}
        onToggleNotifications={() => {
          if (rightPanel !== 'notifications') markPaymentsSeen();
          togglePanel('notifications');
        }}
        isNotificationsOpen={rightPanel === 'notifications'}
        isWalletOpen={isWalletOpen}
        currentUserId={currentUser.id}
        onOpenProfile={setProfileCardUser}
        onRefreshWallet={SERVICES_MODE === 'api' ? () => void refreshWallet() : undefined}
        isRefreshingWallet={isRefreshingWallet}
        notifications={{ transactions, unread: unreadPayments + dmUnreadTotal, onOpen: markPaymentsSeen }}
        balanceUSDC={balanceUSDC}
        onOpenQuickInvoice={inDm ? undefined : () => setIsQuickInvoiceOpen(true)}
        onPayInvoice={handlePayInvoice}
        canPost={canPostHere}
        canModerate={canModerate && !inDm}
        onOpenChannelSettings={isCommunityOwner && !inDm ? () => setChannelSettingsId(activeChannel.id) : undefined}
        onEditMessage={handleEditMessage}
        onDeleteMessage={handleDeleteMessage}
        onOpenVaquita={(id) => {
          setAppsTarget({ vaquitaId: id, nonce: Date.now() });
          setRightPanel('apps');
        }}
      />

      <MemberList
        members={currentMembers}
        isOpen={isMemberListOpen && !inDm}
        onClose={() => setRightPanel(null)}
        onOpenProfile={setProfileCardUser}
        currentUserId={currentUser.id}
        onMessage={(u) => void handleStartDm(u.username)}
      />

      {rightPanel === 'notifications' ? (
        <NotificationsPanel
          transactions={transactions}
          threads={dmThreads}
          onOpenThread={(id) => {
            setView('dms');
            handleSelectThread(id);
            setRightPanel(null);
          }}
          onClose={() => setRightPanel(null)}
        />
      ) : null}

      {rightPanel === 'apps' ? (
        <AppsPanel
          key={appsTarget?.nonce ?? 0}
          initialAppId={appsTarget ? 'vaquita' : undefined}
          initialParams={appsTarget ? { vaquitaId: appsTarget.vaquitaId } : undefined}
          // `share` de una mini-app publica en el CANAL abierto; en un mensaje directo no hay canal y no se ofrece.
          activeChannel={inDm ? null : { id: activeChannel.id, name: activeChannel.name }}
          theme={theme}
          shareToChannel={(text) => (inDm ? Promise.resolve(null) : postToActiveChat(text))}
          onPaid={async (tx) => {
            // Un pago de una mini-app: igual que un envío normal, se actualiza el historial y el saldo.
            setTransactions((prev) => [tx, ...prev]);
            const balances = await walletService.getBalances(publicKey);
            setBalanceUSDC(balances.usdc);
            setBalanceXLM(balances.xlm);
          }}
          community={activeCommunity}
          currentUser={currentUser}
          onClose={() => setRightPanel(null)}
          requestApproval={requestApproval}
          notify={(kind, text) => setPayNotice({ kind, text })}
        />
      ) : null}

      <UserCard
        user={profileCardUser}
        role={profileCardUser ? currentMembers.find((mm) => mm.id === profileCardUser.id)?.role : undefined}
        isSelf={profileCardUser?.id === currentUser.id}
        onClose={() => setProfileCardUser(null)}
        onTransfer={(username) => {
          setProfileCardUser(null);
          setSendTo({ recipient: username, nonce: Date.now() });
          setRightPanel('wallet');
        }}
        onMessage={(username) => void handleStartDm(username)}
        onEditProfile={() => {
          setProfileCardUser(null);
          setIsProfileModalOpen(true);
        }}
      />

      <ProfileModal
        user={currentUser}
        isOpen={isProfileModalOpen}
        onClose={() => setIsProfileModalOpen(false)}
        onSave={handleUpdateProfile}
        stellarAddress={publicKey}
        onLogout={SERVICES_MODE === 'api' ? () => void handleLogout() : undefined}
      />

      <WalletDrawer
        isOpen={isWalletOpen}
        onClose={() => setRightPanel(null)}
        docked
        balanceUSDC={balanceUSDC}
        balanceXLM={balanceXLM}
        publicKey={publicKey}
        transactions={transactions}
        onSend={handleSendPayment}
        sendTo={sendTo}
        onRefresh={SERVICES_MODE === 'api' ? () => void refreshWallet() : undefined}
        isRefreshing={isRefreshingWallet}
      />

      <CreateChannelModal
        isOpen={isCreateChannelOpen}
        onClose={() => setIsCreateChannelOpen(false)}
        onCreate={handleCreateChannel}
        categories={activeCommunity.categories ?? []}
        defaultCategoryId={newChannelCategory}
      />

      <CreateCommunityModal
        isOpen={isCreateCommunityOpen}
        onClose={() => setIsCreateCommunityOpen(false)}
        onCreate={handleCreateCommunity}
      />

      <CommunitySettingsModal
        community={activeCommunity}
        isOpen={isCommunitySettingsOpen}
        onClose={() => setIsCommunitySettingsOpen(false)}
        myRole={SERVICES_MODE !== 'api' ? 'owner' : myCommunityRole}
        currentUserId={currentUser.id}
        onSaveImage={handleSaveCommunityImage}
        onSaveDescription={handleSaveCommunityDescription}
        onSaveChannelTopic={handleSaveChannelTopic}
        onUpdateChannel={handleUpdateChannel}
        onMoveChannel={handleMoveChannel}
        onCreateCategory={handleCreateCategory}
        onRenameCategory={handleRenameCategory}
        onMoveCategory={handleMoveCategory}
        onDeleteCategory={handleDeleteCategory}
        onChangeRole={handleChangeRole}
        onDeleteChannel={handleDeleteChannel}
        onDeleteCommunity={handleDeleteCommunity}
      />

      <ChannelSettingsModal
        channel={activeCommunity.channels.find((ch) => ch.id === channelSettingsId) ?? null}
        onClose={() => setChannelSettingsId(null)}
        onUpdate={async (id, patch) => {
          const ok = await handleUpdateChannel(id, patch);
          if (ok) setPayNotice({ kind: 'ok', text: 'Canal guardado.' });
          return ok;
        }}
        categories={activeCommunity.categories ?? []}
        onDelete={handleDeleteChannel}
      />

      <QuickInvoiceModal
        isOpen={isQuickInvoiceOpen}
        onClose={() => setIsQuickInvoiceOpen(false)}
        onSubmit={handleCreateInvoice}
      />
      {payNotice ? (
        <div
          role={payNotice.kind === 'error' ? 'alert' : 'status'}
          onClick={() => setPayNotice(null)}
          title="Clic para cerrar"
          style={{
            position: 'fixed', left: '50%', bottom: 24, transform: 'translateX(-50%)', zIndex: 1000,
            maxWidth: 'min(92vw, 520px)', padding: '12px 16px', borderRadius: 12, fontSize: 14, cursor: 'pointer',
            background: payNotice.kind === 'error' ? '#3a1616' : '#0b1f21',
            color: payNotice.kind === 'error' ? '#ffb4b4' : '#f2fbfa',
            border: `1px solid ${payNotice.kind === 'ok' ? '#2dd4bf' : payNotice.kind === 'error' ? '#f87171' : '#143235'}`,
            boxShadow: '0 8px 24px rgba(0,0,0,0.35)',
          }}
        >
          {payNotice.text}
        </div>
      ) : null}
    </div>
  );
}
