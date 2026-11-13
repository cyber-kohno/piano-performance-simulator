<script lang="ts">
  import type { TimelineHeaderData } from '../state/timeline-header.ts';
  let { data, start, end, width, pixelsPerSixteenth }: {
    data: TimelineHeaderData; start: number; end: number; width: number; pixelsPerSixteenth: number;
  } = $props();
  const boundaries = $derived(data.boundaries.flatMap((item, index) => {
    const x = item.position * pixelsPerSixteenth;
    const right = (data.boundaries[index + 1]?.position ?? item.position + 8) * pixelsPerSixteenth;
    return x >= start && x <= end ? [{ ...item, x, width: Math.max(0, right - x - 6) }] : [];
  }));
  const markers = $derived(data.markers.flatMap((marker, index) => {
    const x = marker.position * pixelsPerSixteenth;
    const next = data.markers[index + 1]?.position;
    const right = next === undefined ? width + 240 : next * pixelsPerSixteenth;
    return x >= start && x <= end ? [{ ...marker, x, width: Math.max(0, right - x - 4) }] : [];
  }));
</script>

<div class="event-row" aria-label="Elapsed time and score events" style={`width: calc(${width}px + 50cqw)`}>
  {#each boundaries as boundary (boundary.id)}
    <span class="elapsed-time" style={`left: ${boundary.x + 5}px; max-width: ${boundary.width}px`}
      title={`Elapsed time: ${boundary.label}`}>{boundary.label}</span>
  {/each}
  {#each markers as marker (marker.position)}
    <div class="event-group" style={`left: ${marker.x + 5}px; max-width: ${marker.width}px`}
      title={marker.events.map(event => event.label).join(' · ')}>
      {#each marker.events as event (event.id)}
        <span class="event" data-kind={event.kind}>{event.label}</span>
      {/each}
    </div>
  {/each}
</div>

<style>
  .event-row { position: absolute; top: 0; left: 0; min-width: 100%; height: 50px; background: #93bbc1; overflow: hidden; }
  .elapsed-time { position: absolute; top: 2px; color: #23474f; font-size: 12px; line-height: 19px; white-space: nowrap; font-variant-numeric: tabular-nums; overflow: hidden; text-overflow: ellipsis; }
  .event-group { position: absolute; top: 24px; height: 23px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: #244952; }
  .event { margin-right: 6px; padding: 1px 4px; font-size: 12px; line-height: 21px; }
  .event[data-kind='section'] { background: #e5e5b6; color: #4c4c22; font-weight: 600; }
  .event[data-kind='key'] { background: #c5dcd4; color: #375c4c; }
  .event[data-kind='tempo'] { background: #c8dde8; color: #2f5268; }
</style>
