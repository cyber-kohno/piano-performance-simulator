<script lang="ts">
  let { position, pixelsPerSixteenth }: { position: number; pixelsPerSixteenth: number } = $props();
</script>

<div
  class="playback-position"
  aria-label="Playback position"
  style={`left: ${position * pixelsPerSixteenth}px`}
>
  <div class="playback-trail"></div>
  <div class="playback-line"></div>
</div>

<style>
  .playback-position {
    position: absolute;
    z-index: 12;
    top: 0;
    bottom: 0;
    width: 6px;
    pointer-events: none;
  }

  .playback-trail {
    position: absolute;
    top: 0;
    right: 6px;
    bottom: 0;
    width: 300px;
    background: linear-gradient(to right, rgba(255, 251, 39, 0), rgba(39, 118, 255, 0.809));
  }

  .playback-line {
    position: absolute;
    top: var(--pitch-top-margin);
    bottom: var(--pitch-bottom-margin);
    left: 0;
    width: 6px;
    background: rgba(0, 89, 255, 0.85);
  }
</style>
