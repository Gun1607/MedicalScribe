import React, { useState, useEffect } from 'react';
import { Plus, Trash2, User, FileText, Pill, Stethoscope, Activity, ClipboardList, CalendarCheck, ShieldAlert } from 'lucide-react';

const SectionHeader = ({ icon: Icon, title }) => (
  <div className="flex items-center gap-2 pb-2 mb-4 border-b-2 border-blue-100">
    <Icon className="w-5 h-5 text-blue-600" />
    <h3 className="text-lg font-semibold text-slate-800">{title}</h3>
  </div>
);

const FieldLabel = ({ children, htmlFor }) => (
  <label htmlFor={htmlFor} className="block text-sm font-medium text-slate-600 mb-1">
    {children}
  </label>
);

const InputField = ({ label, id, value, onChange, type = 'text', placeholder = '' }) => (
  <div>
    <FieldLabel htmlFor={id}>{label}</FieldLabel>
    <input
      id={id}
      type={type}
      value={value}
      onChange={onChange}
      placeholder={placeholder}
      className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-800 shadow-sm focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 focus:outline-none transition-colors"
    />
  </div>
);

const TextAreaField = ({ label, id, value, onChange, rows = 3, placeholder = '' }) => (
  <div>
    <FieldLabel htmlFor={id}>{label}</FieldLabel>
    <textarea
      id={id}
      value={value}
      onChange={onChange}
      rows={rows}
      placeholder={placeholder}
      className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-800 shadow-sm focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 focus:outline-none transition-colors resize-y"
    />
  </div>
);

const AddButton = ({ onClick, label }) => (
  <button
    type="button"
    onClick={onClick}
    className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-blue-600 bg-blue-50 rounded-lg hover:bg-blue-100 transition-colors"
  >
    <Plus className="w-4 h-4" />
    {label}
  </button>
);

const RemoveButton = ({ onClick, label }) => (
  <button
    type="button"
    onClick={onClick}
    className="p-1.5 text-slate-400 hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors"
    aria-label={label}
    title={label}
  >
    <Trash2 className="w-4 h-4" />
  </button>
);

const VisitDisplay = ({ payload, onSave }) => {
  const [data, setData] = useState(() => structuredClone(payload));

  useEffect(() => {
    setData(structuredClone(payload));
  }, [payload]);

  // Deep-cloning updater to prevent state mutation
  const update = (mutator) => {
    setData((prev) => {
      const next = structuredClone(prev);
      mutator(next);
      return next;
    });
  };

  // --- Patient ---
  const setPatientField = (field, value) => {
    update((d) => {
      if (!d.patient) d.patient = {};
      d.patient[field] = value;
    });
  };

  // --- Simple text fields ---
  const setTextField = (field, value) => {
    update((d) => {
      d[field] = value;
    });
  };

  // --- Array helpers ---
  const setArrayItemField = (arrayName, index, field, value) => {
    update((d) => {
      if (!d[arrayName]) d[arrayName] = [];
      if (!d[arrayName][index]) d[arrayName][index] = {};
      d[arrayName][index][field] = value;
    });
  };

  const addArrayItem = (arrayName, template) => {
    update((d) => {
      if (!d[arrayName]) d[arrayName] = [];
      d[arrayName].push({ ...template });
    });
  };

  const removeArrayItem = (arrayName, index) => {
    update((d) => {
      if (d[arrayName]) {
        d[arrayName].splice(index, 1);
      }
    });
  };

  return (
    <div className="space-y-8">
      {/* ===== Patient Information ===== */}
      <section>
        <SectionHeader icon={User} title="Patient Information" />
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <InputField
            label="Name"
            id="patient-name"
            value={data.patient?.name || ''}
            onChange={(e) => setPatientField('name', e.target.value)}
            placeholder="Patient name"
          />
          <InputField
            label="Age"
            id="patient-age"
            type="number"
            value={data.patient?.age ?? ''}
            onChange={(e) => setPatientField('age', e.target.value === '' ? '' : parseInt(e.target.value, 10))}
            placeholder="Age"
          />
          <InputField
            label="Gender"
            id="patient-gender"
            value={data.patient?.gender || ''}
            onChange={(e) => setPatientField('gender', e.target.value)}
            placeholder="Gender"
          />
        </div>
      </section>

      {/* ===== HPI ===== */}
      <section>
        <SectionHeader icon={FileText} title="History of Present Illness (HPI)" />
        <TextAreaField
          label="HPI"
          id="hpi"
          value={data.hpi || ''}
          onChange={(e) => setTextField('hpi', e.target.value)}
          rows={4}
          placeholder="Describe the history of present illness..."
        />
      </section>

      {/* ===== PMH ===== */}
      <section>
        <SectionHeader icon={ClipboardList} title="Past Medical History (PMH)" />
        <TextAreaField
          label="PMH"
          id="pmh"
          value={data.pmh || ''}
          onChange={(e) => setTextField('pmh', e.target.value)}
          rows={3}
          placeholder="Past medical history..."
        />
      </section>

      {/* ===== Allergies ===== */}
      <section>
        <SectionHeader icon={ShieldAlert} title="Allergies" />
        <TextAreaField
          label="Allergies"
          id="allergies"
          value={data.allergies || ''}
          onChange={(e) => setTextField('allergies', e.target.value)}
          rows={2}
          placeholder="List known allergies..."
        />
      </section>

      {/* ===== Symptoms ===== */}
      <section>
        <SectionHeader icon={Activity} title="Symptoms" />
        {data.symptoms?.length > 0 ? (
          <div className="space-y-3">
            {data.symptoms.map((symp, i) => (
              <div key={i} className="flex items-start gap-3 p-3 bg-slate-50 rounded-lg border border-slate-200">
                <div className="grid grid-cols-1 sm:grid-cols-4 gap-3 flex-1">
                  <InputField
                    label="Name"
                    id={`symptom-name-${i}`}
                    value={symp.name || ''}
                    onChange={(e) => setArrayItemField('symptoms', i, 'name', e.target.value)}
                    placeholder="Symptom name"
                  />
                  <InputField
                    label="Severity"
                    id={`symptom-severity-${i}`}
                    value={symp.severity || ''}
                    onChange={(e) => setArrayItemField('symptoms', i, 'severity', e.target.value)}
                    placeholder="e.g. mild, moderate"
                  />
                  <InputField
                    label="Duration"
                    id={`symptom-duration-${i}`}
                    value={symp.duration || ''}
                    onChange={(e) => setArrayItemField('symptoms', i, 'duration', e.target.value)}
                    placeholder="e.g. 3 days"
                  />
                  <InputField
                    label="Details"
                    id={`symptom-details-${i}`}
                    value={symp.details || ''}
                    onChange={(e) => setArrayItemField('symptoms', i, 'details', e.target.value)}
                    placeholder="Additional details"
                  />
                </div>
                <div className="pt-6">
                  <RemoveButton onClick={() => removeArrayItem('symptoms', i)} label={`Remove symptom ${i + 1}`} />
                </div>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-sm text-slate-400 italic mb-3">No symptoms recorded.</p>
        )}
        <div className="mt-3">
          <AddButton
            onClick={() => addArrayItem('symptoms', { name: '', severity: '', duration: '', details: '' })}
            label="Add Symptom"
          />
        </div>
      </section>

      {/* ===== Conditions ===== */}
      <section>
        <SectionHeader icon={Stethoscope} title="Conditions" />
        {data.conditions?.length > 0 ? (
          <div className="space-y-3">
            {data.conditions.map((cond, i) => (
              <div key={i} className="flex items-start gap-3 p-3 bg-slate-50 rounded-lg border border-slate-200">
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 flex-1">
                  <InputField
                    label="Name"
                    id={`condition-name-${i}`}
                    value={cond.name || ''}
                    onChange={(e) => setArrayItemField('conditions', i, 'name', e.target.value)}
                    placeholder="Condition name"
                  />
                  <InputField
                    label="Status"
                    id={`condition-status-${i}`}
                    value={cond.status || ''}
                    onChange={(e) => setArrayItemField('conditions', i, 'status', e.target.value)}
                    placeholder="e.g. active, resolved"
                  />
                  <InputField
                    label="Notes"
                    id={`condition-notes-${i}`}
                    value={cond.notes || ''}
                    onChange={(e) => setArrayItemField('conditions', i, 'notes', e.target.value)}
                    placeholder="Additional notes"
                  />
                </div>
                <div className="pt-6">
                  <RemoveButton onClick={() => removeArrayItem('conditions', i)} label={`Remove condition ${i + 1}`} />
                </div>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-sm text-slate-400 italic mb-3">No conditions recorded.</p>
        )}
        <div className="mt-3">
          <AddButton
            onClick={() => addArrayItem('conditions', { name: '', status: '', notes: '' })}
            label="Add Condition"
          />
        </div>
      </section>

      {/* ===== Medications ===== */}
      <section>
        <SectionHeader icon={Pill} title="Medications" />
        {data.medications?.length > 0 ? (
          <div className="space-y-3">
            {data.medications.map((med, i) => (
              <div key={i} className="flex items-start gap-3 p-4 bg-slate-50 rounded-lg border border-slate-200">
                <div className="grid grid-cols-1 sm:grid-cols-3 lg:grid-cols-4 gap-3 flex-1">
                  <InputField
                    label="Name"
                    id={`med-name-${i}`}
                    value={med.name || ''}
                    onChange={(e) => setArrayItemField('medications', i, 'name', e.target.value)}
                    placeholder="Medication name"
                  />
                  <InputField
                    label="Drug Class"
                    id={`med-class-${i}`}
                    value={med.drug_class || ''}
                    onChange={(e) => setArrayItemField('medications', i, 'drug_class', e.target.value)}
                    placeholder="e.g. NSAID, ACE inhibitor"
                  />
                  <InputField
                    label="Dosage"
                    id={`med-dosage-${i}`}
                    value={med.dosage || ''}
                    onChange={(e) => setArrayItemField('medications', i, 'dosage', e.target.value)}
                    placeholder="e.g. 500mg"
                  />
                  <InputField
                    label="Route"
                    id={`med-route-${i}`}
                    value={med.route || ''}
                    onChange={(e) => setArrayItemField('medications', i, 'route', e.target.value)}
                    placeholder="e.g. oral, IV"
                  />
                  <InputField
                    label="Frequency"
                    id={`med-frequency-${i}`}
                    value={med.frequency || ''}
                    onChange={(e) => setArrayItemField('medications', i, 'frequency', e.target.value)}
                    placeholder="e.g. twice daily"
                  />
                  <InputField
                    label="Duration"
                    id={`med-duration-${i}`}
                    value={med.duration || ''}
                    onChange={(e) => setArrayItemField('medications', i, 'duration', e.target.value)}
                    placeholder="e.g. 7 days"
                  />
                  <InputField
                    label="Purpose"
                    id={`med-purpose-${i}`}
                    value={med.purpose || ''}
                    onChange={(e) => setArrayItemField('medications', i, 'purpose', e.target.value)}
                    placeholder="Reason for medication"
                  />
                </div>
                <div className="pt-6">
                  <RemoveButton onClick={() => removeArrayItem('medications', i)} label={`Remove medication ${i + 1}`} />
                </div>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-sm text-slate-400 italic mb-3">No medications recorded.</p>
        )}
        <div className="mt-3">
          <AddButton
            onClick={() =>
              addArrayItem('medications', {
                name: '',
                drug_class: '',
                dosage: '',
                route: '',
                frequency: '',
                duration: '',
                purpose: '',
              })
            }
            label="Add Medication"
          />
        </div>
      </section>

      {/* ===== Procedures ===== */}
      <section>
        <SectionHeader icon={ClipboardList} title="Procedures" />
        <TextAreaField
          label="Procedures"
          id="procedures"
          value={data.procedures || ''}
          onChange={(e) => setTextField('procedures', e.target.value)}
          rows={3}
          placeholder="Describe procedures performed or recommended..."
        />
      </section>

      {/* ===== Follow-up ===== */}
      <section>
        <SectionHeader icon={CalendarCheck} title="Follow-up" />
        <TextAreaField
          label="Follow-up"
          id="follow_up"
          value={data.follow_up || ''}
          onChange={(e) => setTextField('follow_up', e.target.value)}
          rows={3}
          placeholder="Follow-up instructions and timeline..."
        />
      </section>

      {/* ===== Save Button ===== */}
      <div className="flex justify-end pt-4 border-t border-slate-200">
        <button
          onClick={() => onSave(data)}
          className="px-6 py-2.5 bg-emerald-600 text-white rounded-xl font-medium hover:bg-emerald-700 transition-colors shadow-sm focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-emerald-500"
        >
          Save to EMR
        </button>
      </div>
    </div>
  );
};

export default VisitDisplay;
