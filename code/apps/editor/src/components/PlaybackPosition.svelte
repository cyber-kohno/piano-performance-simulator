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
    z-index: 10;
    top: 0;
    bottom: 0;
    width: 2px;
    pointer-events: none;
  }

  .playback-trail {
    position: absolute;
    top: 0;
    right: 1px;
    bottom: 0;
    width: 300px;
    background: linear-gradient(to right, rgba(226, 50, 50, 0), rgba(226, 50, 50, 0.2));
  }

  .playback-line {
    position: absolute;
    top: var(--pitch-top-margin);
    bottom: var(--pitch-bottom-margin);
    left: 0;
    width: 2px;
    background: #e23232;
    box-shadow: 0 0 2px rgba(255, 255, 255, 0.9);
  }
</style>
