<script lang="ts">
  import type { InitialValues } from '../model/project';

  let { values, keyEditing = false, tempoEditing = false, meterEditing = false }: {
    values: InitialValues; keyEditing?: boolean; tempoEditing?: boolean; meterEditing?: boolean;
  } = $props();

  const keySignatureText = $derived.by(() => {
    const count = Math.abs(values.keySignature.fifths);
    if (count === 0) return 'None';
    const accidental = values.keySignature.fifths > 0 ? 'sharp' : 'flat';
    return `${count} ${accidental}${count === 1 ? '' : 's'}`;
  });

  const beatUnitText = $derived(
    values.timeSignature.unit === 8 && values.timeSignature.cnt >= 6 && values.timeSignature.cnt % 3 === 0
      ? 'Dotted quarter'
      : values.timeSignature.unit === 4
        ? 'Quarter'
        : values.timeSignature.unit === 2
          ? 'Half'
          : values.timeSignature.unit === 8
            ? 'Eighth'
            : `1/${values.timeSignature.unit} note`,
  );
</script>

<dl class="initial-values">
  <div class:editing={keyEditing}>
    <dt>Key</dt>
    <dd>{keySignatureText}</dd>
  </div>
  <div class:editing={meterEditing}>
    <dt>Meter</dt>
    <dd>{values.timeSignature.cnt}/{values.timeSignature.unit}</dd>
  </div>
  <div class:editing={tempoEditing}>
    <dt>Tempo</dt>
    <dd>{beatUnitText} = {values.tempo}</dd>
  </div>
</dl>

<style>
  .initial-values {
    display: grid;
    gap: 3px;
    margin: 0;
    font-size: 12px;
    line-height: 18px;
  }

  .initial-values > div {
    display: grid;
    grid-template-columns: 44px minmax(0, 1fr);
    gap: 8px;
  }

  .initial-values > div.editing {
    background: rgba(45, 105, 140, 0.18);
    border-radius: 2px;
  }

  dt {
    color: #526a73;
  }

  dd {
    margin: 0;
    font-variant-numeric: tabular-nums;
  }
</style>
