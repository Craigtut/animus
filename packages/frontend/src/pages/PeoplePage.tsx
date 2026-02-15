/** @jsxImportSource @emotion/react */
import { css, useTheme } from '@emotion/react';
import { useState, useMemo } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { MagnifyingGlass, Plus } from '@phosphor-icons/react';
import { Button, Input, Typography } from '../components/ui';
import { trpc } from '../utils/trpc';
import { ContactListItem } from './people/ContactListItem';
import { ContactDetail } from './people/ContactDetail';
import { AddContactModal } from './people/AddContactModal';

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

  // Filter and sort contacts
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
