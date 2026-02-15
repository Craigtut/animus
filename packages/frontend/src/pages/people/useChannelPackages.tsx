/** @jsxImportSource @emotion/react */
import { Globe } from '@phosphor-icons/react';
import { trpc } from '../../utils/trpc';

/** Hook for channel package data */
export function useChannelPackages() {
  const { data: packages, isLoading } = trpc.channels.listPackages.useQuery(undefined, {
    staleTime: 60_000, // Cache for 1 minute
  });
  return { packages: packages ?? [], isLoading };
}

/** Renders the appropriate icon for a channel type */
export function ChannelIcon({
  channelType,
  size = 16,
  className,
}: {
  channelType: string;
  size?: number;
  className?: string;
}) {
  // Built-in web channel always uses Globe
  if (channelType === 'web') {
    return <Globe size={size} className={className} />;
  }

  // For installed packages, fetch the icon
  const { data: iconData, isLoading } = trpc.channels.getIcon.useQuery(
    { name: channelType },
    {
      staleTime: 5 * 60_000, // Cache icon for 5 minutes
      retry: false,
    }
  );

  if (isLoading || !iconData) {
    return <Globe size={size} className={className} />;
  }

  return (
    <img
      src={`data:${iconData.mimeType};base64,${iconData.data}`}
      alt={channelType}
      width={size}
      height={size}
      className={className}
      style={{ display: 'inline-block', verticalAlign: 'middle' }}
    />
  );
}
