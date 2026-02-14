/** @jsxImportSource @emotion/react */
import { css, useTheme } from '@emotion/react';
import { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'motion/react';
import {
  Globe,
  ChatText,
  DiscordLogo,
  Code,
  PencilSimple,
  MagnifyingGlass,
  Plus,
  ArrowLeft,
  NotePencil,
  Brain,
  Trash,
} from '@phosphor-icons/react';
import { Card, Button, Input, Modal, Badge, Typography } from '../components/ui';
import { trpc } from '../utils/trpc';

// ============================================================================
// Helpers
// ============================================================================

const channelIcons: Record<string, React.ElementType> = {
  web: Globe,
  sms: ChatText,
  discord: DiscordLogo,
  api: Code,
};

function getInitials(name: string): string {
  return name
    .split(' ')
    .map((w) => w[0])
    .filter(Boolean)
    .slice(0, 2)
    .join('')
    .toUpperCase();
}

/** Deterministic warm hue from a string */
function nameToHue(name: string): number {
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = name.charCodeAt(i) + ((hash << 5) - hash);
  }
  // Warm hue range: 15-45 (orange-ish)
  return 15 + (Math.abs(hash) % 30);
}

function formatRelativeTime(ts: string | null): string {
  if (!ts) return '';
  const diff = Date.now() - new Date(ts).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(ts).toLocaleDateString();
}

// ============================================================================
// Contact List Item
// ============================================================================

interface ContactListData {
  id: string;
  fullName: string;
  isPrimary: boolean;
  permissionTier: string;
  lastMessage: {
    content: string;
    direction: string;
    createdAt: string;
    channel: string;
  } | null;
}

function ContactListItem({
  contact,
  channels,
  onClick,
}: {
  contact: ContactListData;
  channels: { channel: string; isVerified: boolean }[];
  onClick: () => void;
}) {
  const theme = useTheme();
  const hue = nameToHue(contact.fullName);

  return (
    <Card variant="elevated" interactive padding="md" onClick={onClick}>
      <div css={css`display: flex; align-items: center; gap: ${theme.spacing[4]};`}>
        {/* Avatar */}
        <div
          css={css`
            width: 40px;
            height: 40px;
            border-radius: 50%;
            background: hsl(${hue}, 30%, ${theme.mode === 'light' ? '85%' : '30%'});
            display: flex;
            align-items: center;
            justify-content: center;
            flex-shrink: 0;
          `}
        >
          <Typography.SmallBodyAlt
            as="span"
            color={`hsl(${hue}, 40%, ${theme.mode === 'light' ? '40%' : '75%'})`}
          >
            {getInitials(contact.fullName)}
          </Typography.SmallBodyAlt>
        </div>

        {/* Name + Last message */}
        <div css={css`flex: 1; min-width: 0;`}>
          <div css={css`display: flex; align-items: center; gap: ${theme.spacing[2]};`}>
            <Typography.BodyAlt as="span">
              {contact.fullName}
            </Typography.BodyAlt>
            {contact.isPrimary && (
              <Typography.Caption color={theme.colors.accent}>
                Primary
              </Typography.Caption>
            )}
            {!contact.isPrimary && (
              <Typography.Caption color="secondary">
                Standard
              </Typography.Caption>
            )}
          </div>
          {contact.lastMessage && (
            <Typography.SmallBody
              color="hint"
              css={css`
                white-space: nowrap;
                overflow: hidden;
                text-overflow: ellipsis;
                margin-top: 2px;
              `}
            >
              {contact.lastMessage.direction === 'outbound' ? 'You: ' : ''}
              {contact.lastMessage.content}
            </Typography.SmallBody>
          )}
        </div>

        {/* Right: channels + time */}
        <div css={css`display: flex; flex-direction: column; align-items: flex-end; gap: ${theme.spacing[1]}; flex-shrink: 0;`}>
          <div css={css`display: flex; gap: ${theme.spacing[1]};`}>
            {channels.map((ch, i) => {
              const Icon = channelIcons[ch.channel] ?? Globe;
              return (
                <Icon
                  key={i}
                  size={14}
                  css={css`
                    color: ${theme.colors.text.secondary};
                    opacity: ${ch.isVerified ? 0.55 : 0.3};
                  `}
                />
              );
            })}
          </div>
          {contact.lastMessage && (
            <Typography.Caption color="hint">
              {formatRelativeTime(contact.lastMessage.createdAt)}
            </Typography.Caption>
          )}
        </div>
      </div>
    </Card>
  );
}

// ============================================================================
// Add Contact Modal
// ============================================================================

function AddContactModal({
  open,
  onClose,
  onSuccess,
}: {
  open: boolean;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const theme = useTheme();
  const createMutation = trpc.contacts.create.useMutation({
    onSuccess: () => {
      onSuccess();
      onClose();
      setFullName('');
      setPhone('');
      setEmail('');
    },
  });

  const [fullName, setFullName] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');

  return (
    <Modal open={open} onClose={onClose}>
      <div css={css`display: flex; flex-direction: column; gap: ${theme.spacing[4]};`}>
        <Typography.Subtitle as="h3">
          Add contact
        </Typography.Subtitle>
        <Input
          label="Full name"
          value={fullName}
          onChange={(e) => setFullName((e.target as HTMLInputElement).value)}
          placeholder="Name"
        />
        <Input
          label="Phone number"
          value={phone}
          onChange={(e) => setPhone((e.target as HTMLInputElement).value)}
          placeholder="+1234567890 (optional)"
        />
        <Input
          label="Email"
          value={email}
          onChange={(e) => setEmail((e.target as HTMLInputElement).value)}
          placeholder="email@example.com (optional)"
        />
        <div css={css`display: flex; gap: ${theme.spacing[3]}; justify-content: flex-end;`}>
          <Button variant="ghost" size="sm" onClick={onClose}>Cancel</Button>
          <Button
            size="sm"
            disabled={!fullName.trim()}
            loading={createMutation.isPending}
            onClick={() =>
              createMutation.mutate({
                fullName: fullName.trim(),
                phoneNumber: phone.trim() || null,
                email: email.trim() || null,
              })
            }
          >
            Add
          </Button>
        </div>
      </div>
    </Modal>
  );
}

// ============================================================================
// Contact Detail
// ============================================================================

function ContactDetail({
  contactId,
  onBack,
}: {
  contactId: string;
  onBack: () => void;
}) {
  const theme = useTheme();
  const utils = trpc.useUtils();

  const { data: contact } = trpc.contacts.getById.useQuery({ id: contactId });
  const { data: channels } = trpc.contacts.getChannels.useQuery({ contactId });
  const updateMutation = trpc.contacts.update.useMutation({
    onSuccess: () => {
      utils.contacts.getById.invalidate({ id: contactId });
      utils.contacts.list.invalidate();
      setEditing(false);
    },
  });
  const deleteMutation = trpc.contacts.delete.useMutation({
    onSuccess: () => {
      utils.contacts.list.invalidate();
      onBack();
    },
  });

  const [activeTab, setActiveTab] = useState<'conversation' | 'about'>('conversation');
  const [editing, setEditing] = useState(false);
  const [editName, setEditName] = useState('');
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

  // Notes auto-save
  const [notes, setNotes] = useState('');
  const [notesSaved, setNotesSaved] = useState(false);
  const notesTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const notesSaveMutation = trpc.contacts.update.useMutation({
    onSuccess: () => {
      setNotesSaved(true);
      setTimeout(() => setNotesSaved(false), 1500);
    },
  });

  useEffect(() => {
    if (contact) {
      setEditName(contact.fullName);
      setNotes(contact.notes ?? '');
    }
  }, [contact]);

  const handleNotesChange = useCallback(
    (value: string) => {
      setNotes(value);
      if (notesTimer.current) clearTimeout(notesTimer.current);
      notesTimer.current = setTimeout(() => {
        notesSaveMutation.mutate({ id: contactId, notes: value || null });
      }, 1500);
    },
    [contactId, notesSaveMutation],
  );

  const handleSaveEdit = () => {
    if (!editName.trim()) return;
    updateMutation.mutate({ id: contactId, fullName: editName.trim() });
  };

  if (!contact) {
    return (
      <Typography.Body
        color="hint"
        css={css`padding: ${theme.spacing[8]}; text-align: center;`}
      >
        Loading...
      </Typography.Body>
    );
  }

  return (
    <div css={css`
      max-width: 720px;
      margin: 0 auto;
      padding: ${theme.spacing[4]} ${theme.spacing[6]};
      @media (max-width: ${theme.breakpoints.md}) {
        padding: ${theme.spacing[4]};
      }
    `}>
      {/* Back button */}
      <button
        onClick={onBack}
        css={css`
          display: flex; align-items: center; gap: ${theme.spacing[2]};
          color: ${theme.colors.text.secondary}; font-size: ${theme.typography.fontSize.sm};
          cursor: pointer; padding: 0; margin-bottom: ${theme.spacing[4]};
          &:hover { color: ${theme.colors.text.primary}; }
        `}
      >
        <ArrowLeft size={16} />
        People
      </button>

      {/* Header */}
      <div css={css`margin-bottom: ${theme.spacing[6]};`}>
        {editing ? (
          <div css={css`display: flex; flex-direction: column; gap: ${theme.spacing[3]};`}>
            <Input
              value={editName}
              onChange={(e) => setEditName((e.target as HTMLInputElement).value)}
              label="Name"
            />
            <div css={css`display: flex; gap: ${theme.spacing[2]};`}>
              <Button size="sm" onClick={handleSaveEdit} loading={updateMutation.isPending}>Save</Button>
              <Button variant="ghost" size="sm" onClick={() => setEditing(false)}>Cancel</Button>
            </div>
          </div>
        ) : (
          <>
            <div css={css`display: flex; align-items: center; gap: ${theme.spacing[3]};`}>
              <Typography.Title3 as="h1">
                {contact.fullName}
              </Typography.Title3>
              <button
                onClick={() => setEditing(true)}
                css={css`
                  color: ${theme.colors.text.hint}; cursor: pointer; padding: 0;
                  &:hover { color: ${theme.colors.text.primary}; }
                `}
              >
                <PencilSimple size={16} />
              </button>
            </div>
            <Typography.SmallBody color="secondary">
              {contact.isPrimary ? 'Primary contact' : 'Standard contact'}
            </Typography.SmallBody>
            {channels && channels.length > 0 && (
              <div css={css`display: flex; flex-wrap: wrap; gap: ${theme.spacing[2]}; margin-top: ${theme.spacing[2]};`}>
                {channels.map((ch: any) => {
                  const Icon = channelIcons[ch.channel] ?? Globe;
                  return (
                    <Typography.Caption
                      key={ch.id}
                      color="secondary"
                      css={css`
                        display: inline-flex; align-items: center; gap: ${theme.spacing[1]};
                        padding: ${theme.spacing[0.5]} ${theme.spacing[2]};
                        background: ${theme.colors.background.elevated};
                        border-radius: ${theme.borderRadius.full};
                      `}
                    >
                      <Icon size={12} />
                      {ch.identifier}
                    </Typography.Caption>
                  );
                })}
              </div>
            )}
          </>
        )}
      </div>

      {/* Tabs */}
      <div css={css`
        display: flex; gap: ${theme.spacing[6]};
        border-bottom: 1px solid ${theme.colors.border.light};
        margin-bottom: ${theme.spacing[4]};
      `}>
        {(['conversation', 'about'] as const).map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            css={css`
              padding: ${theme.spacing[2]} 0;
              font-size: ${theme.typography.fontSize.sm};
              font-weight: ${activeTab === tab ? theme.typography.fontWeight.semibold : theme.typography.fontWeight.normal};
              color: ${activeTab === tab ? theme.colors.text.primary : theme.colors.text.secondary};
              border-bottom: 2px solid ${activeTab === tab ? theme.colors.accent : 'transparent'};
              cursor: pointer;
              transition: all ${theme.transitions.micro};
              &:hover { color: ${theme.colors.text.primary}; }
            `}
          >
            {tab.charAt(0).toUpperCase() + tab.slice(1)}
          </button>
        ))}
      </div>

      {/* Tab Content */}
      {activeTab === 'conversation' && (
        <ConversationTab contactId={contactId} isPrimary={contact.isPrimary} />
      )}
      {activeTab === 'about' && (
        <div css={css`display: flex; flex-direction: column; gap: ${theme.spacing[8]};`}>
          {/* Contact Notes */}
          <div css={css`display: flex; flex-direction: column; gap: ${theme.spacing[3]};`}>
            <div css={css`display: flex; align-items: center; gap: ${theme.spacing[2]};`}>
              <NotePencil size={16} css={css`color: ${theme.colors.text.secondary};`} />
              <Typography.BodyAlt as="h3">
                {contact.isPrimary ? 'About you' : 'Your notes'}
              </Typography.BodyAlt>
              <AnimatePresence>
                {notesSaved && (
                  <Typography.Caption
                    as={motion.span}
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    color={theme.colors.success.main}
                  >
                    Saved
                  </Typography.Caption>
                )}
              </AnimatePresence>
            </div>
            <Input
              multiline
              value={notes}
              onChange={(e) => handleNotesChange((e.target as HTMLTextAreaElement).value)}
              placeholder={contact.isPrimary ? 'Notes about yourself...' : `Notes about ${contact.fullName}...`}
              helperText="Auto-saves after 1.5 seconds."
            />
          </div>

          {/* Working Memory (read-only) */}
          <div css={css`display: flex; flex-direction: column; gap: ${theme.spacing[3]};`}>
            <div css={css`display: flex; align-items: center; gap: ${theme.spacing[2]};`}>
              <Brain size={16} css={css`color: ${theme.colors.text.secondary};`} />
              <Typography.BodyAlt as="h3">
                What {contact.fullName.split(' ')[0]} knows
              </Typography.BodyAlt>
            </div>
            <Typography.SmallBody color="hint" italic>
              Your Animus hasn't formed notes about this contact yet.
            </Typography.SmallBody>
          </div>

          {/* Channel Management */}
          {channels && (
            <div css={css`display: flex; flex-direction: column; gap: ${theme.spacing[3]};`}>
              <Typography.BodyAlt as="h3">
                Channels
              </Typography.BodyAlt>
              {channels.map((ch: any) => {
                const Icon = channelIcons[ch.channel] ?? Globe;
                return (
                  <div key={ch.id} css={css`
                    display: flex; align-items: center; justify-content: space-between;
                    padding: ${theme.spacing[2]} ${theme.spacing[3]};
                    border: 1px solid ${theme.colors.border.light};
                    border-radius: ${theme.borderRadius.default};
                  `}>
                    <div css={css`display: flex; align-items: center; gap: ${theme.spacing[2]};`}>
                      <Icon size={16} css={css`color: ${theme.colors.text.secondary};`} />
                      <Typography.SmallBody as="span">{ch.identifier}</Typography.SmallBody>
                      {ch.isVerified && <Badge variant="success">Verified</Badge>}
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {/* Delete contact */}
          {!contact.isPrimary && (
            <div css={css`padding-top: ${theme.spacing[4]}; border-top: 1px solid ${theme.colors.border.light};`}>
              <button
                onClick={() => setShowDeleteConfirm(true)}
                css={css`
                  font-size: ${theme.typography.fontSize.sm};
                  color: ${theme.colors.error.main};
                  cursor: pointer;
                  padding: 0;
                  text-decoration: underline;
                  text-underline-offset: 3px;
                  &:hover { opacity: 0.8; }
                `}
              >
                Delete contact
              </button>
            </div>
          )}

          <Modal open={showDeleteConfirm} onClose={() => setShowDeleteConfirm(false)}>
            <div css={css`display: flex; flex-direction: column; gap: ${theme.spacing[4]};`}>
              <Typography.Subtitle as="h3">
                Delete {contact.fullName}?
              </Typography.Subtitle>
              <Typography.SmallBody color="secondary">
                This will remove the contact and all their channel associations. Message history will be preserved.
              </Typography.SmallBody>
              <div css={css`display: flex; gap: ${theme.spacing[3]}; justify-content: flex-end;`}>
                <Button variant="ghost" size="sm" onClick={() => setShowDeleteConfirm(false)}>Cancel</Button>
                <Button variant="danger" size="sm" onClick={() => deleteMutation.mutate({ id: contactId })} loading={deleteMutation.isPending}>
                  Delete
                </Button>
              </div>
            </div>
          </Modal>
        </div>
      )}
    </div>
  );
}

// ============================================================================
// Conversation Tab
// ============================================================================

function ConversationTab({
  contactId,
  isPrimary,
}: {
  contactId: string;
  isPrimary: boolean;
}) {
  const theme = useTheme();

  // For the primary contact, we show messages and an input.
  // For others, read-only.
  const { data: messagesData } = trpc.messages.getRecent.useQuery(
    { limit: 50 },
    { retry: false },
  );

  // TODO: For non-primary contacts, fetch messages filtered by contactId
  // when a contactId-based message query is available in the backend.
  // For now, show primary contact messages if primary, otherwise empty.

  const messages = isPrimary ? (messagesData ?? []) : [];

  const [inputValue, setInputValue] = useState('');
  const sendMutation = trpc.messages.send.useMutation({
    onSuccess: () => setInputValue(''),
  });
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    requestAnimationFrame(() => {
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    });
  }, [messages.length]);

  if (messages.length === 0) {
    return (
      <Typography.Body
        color="hint"
        css={css`
          text-align: center;
          padding: ${theme.spacing[16]} 0;
        `}
      >
        No messages yet.
      </Typography.Body>
    );
  }

  return (
    <div>
      <div css={css`
        display: flex; flex-direction: column; gap: ${theme.spacing[3]};
        padding-bottom: ${isPrimary ? theme.spacing[20] : theme.spacing[4]};
      `}>
        {messages.map((msg: any) => {
          const isUser = msg.direction === 'inbound';
          return (
            <div
              key={msg.id}
              css={css`
                display: flex;
                justify-content: ${isUser ? 'flex-end' : 'flex-start'};
              `}
            >
              <Typography.Body
                as="div"
                color="primary"
                css={css`
                  max-width: ${isUser ? '80%' : '85%'};
                  ${isUser
                    ? `
                    background: ${theme.mode === 'light' ? 'hsl(30, 20%, 92%)' : 'hsl(30, 15%, 22%)'};
                    border-radius: 16px;
                    padding: ${theme.spacing[3]} ${theme.spacing[4]};
                  `
                    : ''}
                  white-space: pre-wrap;
                `}
              >
                {msg.content}
                <Typography.Caption
                  as="div"
                  color="hint"
                  css={css`
                    margin-top: ${theme.spacing[0.5]};
                    display: flex;
                    align-items: center;
                    gap: ${theme.spacing[1]};
                  `}
                >
                  {msg.channel && (() => {
                    const Icon = channelIcons[msg.channel] ?? Globe;
                    return <Icon size={10} />;
                  })()}
                  {formatRelativeTime(msg.createdAt)}
                </Typography.Caption>
              </Typography.Body>
            </div>
          );
        })}
        <div ref={messagesEndRef} />
      </div>

      {/* Message input for primary contact only */}
      {isPrimary && (
        <div css={css`
          position: fixed;
          bottom: 0; left: 0; right: 0;
          z-index: ${theme.zIndex.sticky};
          padding: ${theme.spacing[3]} ${theme.spacing[4]};
          padding-bottom: max(${theme.spacing[3]}, env(safe-area-inset-bottom));
          background: ${theme.colors.background.default};
          border-top: 1px solid ${theme.colors.border.light};
          @media (max-width: ${theme.breakpoints.md}) { bottom: 56px; }
        `}>
          <div css={css`
            max-width: 720px; margin: 0 auto;
            display: flex; align-items: flex-end; gap: ${theme.spacing[2]};
          `}>
            <textarea
              value={inputValue}
              onChange={(e) => setInputValue(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  const trimmed = inputValue.trim();
                  if (trimmed && !sendMutation.isPending) {
                    sendMutation.mutate({ content: trimmed, channel: 'web' });
                  }
                }
              }}
              placeholder="Message..."
              rows={1}
              css={css`
                flex: 1;
                padding: ${theme.spacing[3]} ${theme.spacing[4]};
                background: ${theme.colors.background.paper};
                border: 1px solid ${theme.colors.border.default};
                border-radius: 20px;
                color: ${theme.colors.text.primary};
                font-size: ${theme.typography.fontSize.base};
                line-height: ${theme.typography.lineHeight.normal};
                resize: none;
                outline: none;
                max-height: 120px;
                overflow-y: auto;
                &:focus { border-color: ${theme.colors.border.focus}; }
                &::placeholder { color: ${theme.colors.text.hint}; }
              `}
            />
          </div>
        </div>
      )}
    </div>
  );
}

// ============================================================================
// People Page (main export)
// ============================================================================

export function PeoplePage() {
  const theme = useTheme();
  const location = useLocation();
  const navigate = useNavigate();
  const utils = trpc.useUtils();

  const { data: contactList, isLoading } = trpc.contacts.list.useQuery();

  const [searchQuery, setSearchQuery] = useState('');
  const [showAddModal, setShowAddModal] = useState(false);

  // Determine if we're viewing a contact detail
  const contactIdFromPath = useMemo(() => {
    const match = location.pathname.match(/^\/people\/([a-f0-9-]+)$/);
    return match ? match[1] : null;
  }, [location.pathname]);

  // Fetch channels for each contact (for the list view icons)
  // We'll just show basic channel info from the list enrichment
  const contacts = useMemo(() => {
    if (!contactList) return [];
    let filtered = contactList;
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      filtered = contactList.filter((c: any) => c.fullName.toLowerCase().includes(q));
    }
    // Sort: primary first, then by last message date
    return [...filtered].sort((a: any, b: any) => {
      if (a.isPrimary && !b.isPrimary) return -1;
      if (!a.isPrimary && b.isPrimary) return 1;
      const aTime = a.lastMessage?.createdAt ?? '';
      const bTime = b.lastMessage?.createdAt ?? '';
      return bTime.localeCompare(aTime);
    });
  }, [contactList, searchQuery]);

  if (contactIdFromPath) {
    return (
      <ContactDetail
        contactId={contactIdFromPath}
        onBack={() => navigate('/people')}
      />
    );
  }

  return (
    <div css={css`
      max-width: 720px;
      margin: 0 auto;
      padding: ${theme.spacing[6]} ${theme.spacing[6]};
      @media (max-width: ${theme.breakpoints.md}) {
        padding: ${theme.spacing[4]};
      }
    `}>
      {/* Search */}
      <div css={css`margin-bottom: ${theme.spacing[4]};`}>
        <Input
          value={searchQuery}
          onChange={(e) => setSearchQuery((e.target as HTMLInputElement).value)}
          placeholder="Search contacts..."
          rightElement={<MagnifyingGlass size={16} css={css`color: ${theme.colors.text.hint};`} />}
        />
      </div>

      {/* Contact List */}
      {isLoading ? (
        <Typography.Body
          color="hint"
          css={css`text-align: center; padding: ${theme.spacing[8]};`}
        >
          Loading contacts...
        </Typography.Body>
      ) : contacts.length === 0 && !searchQuery ? (
        <div css={css`text-align: center; padding: ${theme.spacing[8]}; display: flex; flex-direction: column; align-items: center; gap: ${theme.spacing[4]};`}>
          <Typography.Body color="hint">
            Other contacts will appear here as people message your Animus through SMS, Discord, or API. You can also add contacts manually.
          </Typography.Body>
          <Button variant="secondary" size="sm" onClick={() => setShowAddModal(true)}>
            <Plus size={14} /> Add contact
          </Button>
        </div>
      ) : contacts.length === 0 && searchQuery ? (
        <Typography.Body
          color="hint"
          css={css`text-align: center; padding: ${theme.spacing[8]};`}
        >
          No contacts match "{searchQuery}"
        </Typography.Body>
      ) : (
        <div css={css`display: flex; flex-direction: column; gap: ${theme.spacing[3]};`}>
          {contacts.map((contact: any) => (
            <ContactListItem
              key={contact.id}
              contact={contact}
              channels={[]} // Channels are per-contact; would need separate queries
              onClick={() => navigate(`/people/${contact.id}`)}
            />
          ))}
        </div>
      )}

      {/* Add contact button */}
      {contacts.length > 0 && (
        <div css={css`margin-top: ${theme.spacing[6]}; text-align: center;`}>
          <Button variant="secondary" size="sm" onClick={() => setShowAddModal(true)}>
            <Plus size={14} /> Add contact
          </Button>
        </div>
      )}

      <AddContactModal
        open={showAddModal}
        onClose={() => setShowAddModal(false)}
        onSuccess={() => utils.contacts.list.invalidate()}
      />
    </div>
  );
}
