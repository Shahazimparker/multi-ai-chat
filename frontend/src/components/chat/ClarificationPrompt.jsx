import React, { useMemo, useState } from 'react';
import './ClarificationPrompt.css';

const buildFollowUpMessage = (intent, values, questions) => {
  const lines = [
    '[ARTIFACT DETAILS]',
    `Intent: ${intent}`,
    ...questions.map((question) => `${question.label}: ${values[question.id] || ''}`),
    '[END ARTIFACT DETAILS]',
    '',
  ];

  if (intent === 'generate_ppt') {
    return [
      ...lines,
      `Create the presentation using these details. Use the topic as the title if no better title is needed.`,
    ].join('\n');
  }

  const directives = {
    generate_image: 'Create the image using these details and turn them into a strong visual prompt.',
    generate_pdf: 'Create the PDF using these details.',
    generate_excel: 'Create the Excel spreadsheet using these details.',
    generate_docx: 'Create the Word document using these details.',
    generate_csv: 'Create the CSV using these details.',
    generate_chart: 'Create the chart using these details.',
    generate_html: 'Create the HTML page using these details.',
    generate_json: 'Create the JSON file using these details.',
    generate_md: 'Create the Markdown document using these details.',
  };

  return [...lines, directives[intent] || 'Create the requested artifact using these details.'].join('\n');
};

const ClarificationPrompt = ({ request, onSubmit }) => {
  const initialValues = useMemo(() => (
    (request?.questions || []).reduce((acc, question) => {
      acc[question.id] = question.value || '';
      return acc;
    }, {})
  ), [request]);
  const [values, setValues] = useState(initialValues);
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const handleChange = (id, value) => {
    setValues((prev) => ({ ...prev, [id]: value }));
    setError('');
  };

  const handleSubmit = async () => {
    const missing = (request?.questions || []).find((question) => question.required && !String(values[question.id] || '').trim());
    if (missing) {
      setError(`Enter ${missing.label.toLowerCase()}.`);
      return;
    }

    setSubmitting(true);
    try {
      const followUp = buildFollowUpMessage(request.intent, values, request.questions || []);
      await onSubmit?.(followUp);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="cp">
      <div className="cp__header">
        <span className="cp__badge">Clarify</span>
        <span className="cp__title">{request?.message || 'Provide the missing details.'}</span>
      </div>

      <div className="cp__fields">
        {(request?.questions || []).map((question) => (
          <label key={question.id} className="cp__field">
            <span className="cp__label">{question.label}</span>
            {question.kind === 'select' ? (
              <select
                className="cp__input"
                value={values[question.id] || ''}
                onChange={(event) => handleChange(question.id, event.target.value)}
                disabled={submitting}
              >
                {(question.options || []).map((option) => (
                  <option key={option.value} value={option.value}>{option.label}</option>
                ))}
              </select>
            ) : (
              <input
                className="cp__input"
                type="text"
                value={values[question.id] || ''}
                placeholder={question.placeholder || ''}
                onChange={(event) => handleChange(question.id, event.target.value)}
                disabled={submitting}
              />
            )}
          </label>
        ))}
      </div>

      <div className="cp__actions">
        <button className="cp__btn" onClick={handleSubmit} disabled={submitting}>
          {submitting ? 'Sending...' : 'Continue'}
        </button>
      </div>

      {error && <div className="cp__error">{error}</div>}
    </div>
  );
};

export default React.memo(ClarificationPrompt);
