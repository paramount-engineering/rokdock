/**
 * Shared sample data for the documentation capture scripts, so figures that show
 * the same data stay consistent (e.g. the Deeplinks panel in deeplinks-live and
 * the Deeplinks settings tab in settings-deeplinks show the identical entries).
 */

/** Sample deeplink presets seeded before capturing the Deeplinks panel and tab. */
export const SAMPLE_DEEPLINKS = [
    { id: 'dl-launch-dev', name: 'Launch Dev Channel', type: 'launch', appId: 'dev', mediaType: '', contentId: '', extraParams: [] },
    { id: 'dl-play-movie', name: 'Play Test Movie', type: 'launch', appId: 'dev', mediaType: 'movie', contentId: 'abc123', extraParams: [] },
    { id: 'dl-input-refresh', name: 'Send Refresh Input', type: 'input', appId: 'dev', mediaType: 'special', contentId: 'refresh', extraParams: [] },
]
