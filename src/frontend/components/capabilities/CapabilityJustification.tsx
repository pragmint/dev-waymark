
export const CapabilityJustification = ({ text }: { text: string | undefined }) => {
  if (!text) return <></>;
  return (
    <div class="justification-section">
      <h4 class="justification-header">Justification</h4>
      <div class="justification-text">
        {text.split('\n').map((paragraph, i) => (
          <p key={i}>{paragraph}</p>
        ))}
      </div>
    </div>
  );
};

