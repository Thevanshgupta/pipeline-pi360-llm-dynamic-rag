import React, { useState, useRef, useEffect } from 'react';
import './Chatbot.css';

const Chatbot = () => {
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [activeSection, setActiveSection] = useState('research');
  const chatWindowRef = useRef(null);

  // Load conversation history from localStorage
  const [conversationHistory, setConversationHistory] = useState(() => {
    const saved = localStorage.getItem('chatHistory');
    return saved ? JSON.parse(saved) : [];
  });

  const WORKER_URLS = {
    workshop: 'https://pi360-rag-sql-generator.theshinchangupta.workers.dev',
    students: 'https://pi360-sql-generator.karan-cse.workers.dev',
    training: 'https://pi360-rag-sql-generator.theshinchangupta.workers.dev',
    research: 'https://pi360-rag-sql-generator.theshinchangupta.workers.dev',
    seminar: 'https://pi360-rag-sql-generator.theshinchangupta.workers.dev',
    conference: 'https://pi360-rag-sql-generator.theshinchangupta.workers.dev',
  };

  // Save conversation history to localStorage whenever it changes
  useEffect(() => {
    localStorage.setItem('chatHistory', JSON.stringify(conversationHistory));
  }, [conversationHistory]);

  const generateContextualQuery = async (userInput) => {
    if (conversationHistory.length === 0) return userInput;

    try {
      const response = await fetch('https://pi360-deepseek-model.theshinchangupta.workers.dev', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: [
            {
              role: 'system',
              content: `You are a query refinement assistant. Based on conversation history and new input, create an improved query. Rules:
              1. Maintain original intent
              2. Incorporate relevant context
              3. Never mention "previous results" directly
              4. Keep it concise`
            },
            {
              role: 'user',
              content: `Conversation history:\n${JSON.stringify(conversationHistory.slice(-3))}\n\nNew query: ${userInput}`
            }
          ],
          temperature: 0.3
        }),
      });

      if (!response.ok) throw new Error('LLM refinement failed');
      const data = await response.json();
      return data.response;
    } catch (error) {
      console.error('Contextual query error:', error);
      return userInput;
    }
  };

  const generateSQL = async (prompt, section) => {
    try {
      const payload = section === 'students'
        ? { content: prompt, section }
        : { schemaName: section, content: prompt };

      const response = await fetch(WORKER_URLS[section], {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`SQL generation failed: ${errorText}`);
      }

      const data = await response.json();
      return data.query;
    } catch (error) {
      console.error('SQL Generation Error:', error);
      throw error;
    }
  };

  const executeQuery = async (sqlQuery) => {
    try {
      const encodedQuery = btoa(sqlQuery);
      const response = await fetch(
        `https://pi360.net/site/api/endpoints/chat.php?institute_id=mietjammu&secret=R0dqSDg3Njc2cC00NCNAaHg=&query=${encodedQuery}`
      );

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Query execution failed: ${errorText}`);
      }

      const data = await response.json();
      if (data.response_code !== "200") {
        throw new Error(data.response_message || 'Database error');
      }

      return data.content;
    } catch (error) {
      console.error('Query Execution Error:', error);
      throw error;
    }
  };

  const analyzeResults = async (data, originalPrompt) => {
    try {
      // First check for simple count results
      if (data.length === 1 && data[0].count !== undefined) {
        return `Found ${data[0].count} records matching your query.`;
      }

      // For more complex results, use LLM analysis
      const response = await fetch('https://pi360-deepseek-model.theshinchangupta.workers.dev', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: [
            { 
              role: 'system', 
              content: `Analyze this data and provide a 1-2 sentence summary. Focus on key insights.
              Data: ${JSON.stringify(data)}`
            },
            { 
              role: 'user', 
              content: `Summarize results for: "${originalPrompt}"`
            }
          ],
          temperature: 0.2
        }),
      });

      if (!response.ok) throw new Error('Analysis failed');
      const result = await response.json();
      return result.response;
    } catch (error) {
      console.error('Analysis Error:', error);
      return `Received ${data.length} records. ${error.message}`;
    }
  };

  const handleSend = async () => {
    if (!input.trim()) return;

    const userMessage = {
      id: Date.now(),
      type: 'user',
      content: input,
      timestamp: new Date().getTime()
    };

    setMessages(prev => [...prev, userMessage]);
    setInput('');
    setIsLoading(true);

    try {
      // Step 1: Generate contextual query using LLM
      const contextualQuery = await generateContextualQuery(input);
      
      // Step 2: Generate SQL from the refined prompt
      const sqlQuery = await generateSQL(contextualQuery, activeSection);
      
      // Step 3: Execute the SQL query
      const queryResults = await executeQuery(sqlQuery);
      
      // Step 4: Analyze the results
      const analysis = await analyzeResults(queryResults, input);

      // Update conversation history
      const newHistoryEntry = {
        userQuery: input,
        refinedQuery: contextualQuery,
        sqlQuery,
        results: queryResults,
        analysis,
        timestamp: new Date().getTime()
      };

      setConversationHistory(prev => [...prev, newHistoryEntry].slice(-10)); // Keep last 10 interactions

      // Add bot response
      setMessages(prev => [
        ...prev,
        {
          id: Date.now() + 1,
          type: 'bot',
          content: analysis,
          responseData: {
            sql: sqlQuery,
            rawData: queryResults,
            usedContext: contextualQuery !== input
          }
        }
      ]);

    } catch (error) {
      setMessages(prev => [
        ...prev,
        {
          id: Date.now() + 1,
          type: 'bot',
          content: `Error: ${error.message}`,
          isError: true
        }
      ]);
    } finally {
      setIsLoading(false);
    }
  };

  const exportCSV = (data, filename = 'data.csv') => {
    if (!data || data.length === 0) return;

    const headers = Object.keys(data[0]).join(',');
    const rows = data.map(item => 
      Object.values(item).map(val => 
        `"${String(val).replace(/"/g, '""')}"`
      ).join(',')
    ).join('\n');

    const csv = `${headers}\n${rows}`;
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    link.click();
  };

  const renderDataTable = (data) => {
    if (!data || data.length === 0) return null;

    return (
      <div className="data-table-container">
        <button 
          className="export-btn"
          onClick={() => exportCSV(data, `export-${Date.now()}.csv`)}
        >
          Export CSV
        </button>
        <table className="data-table">
          <thead>
            <tr>
              {Object.keys(data[0]).map(key => (
                <th key={key}>{key}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {data.map((row, i) => (
              <tr key={i}>
                {Object.values(row).map((val, j) => (
                  <td key={j}>{String(val)}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  };

  const clearHistory = () => {
    setConversationHistory([]);
    localStorage.removeItem('chatHistory');
  };

  useEffect(() => {
    chatWindowRef.current?.scrollTo(0, chatWindowRef.current.scrollHeight);
  }, [messages]);

  return (
    <div className="chatbot-container">
      <div className="section-selector">
        {Object.keys(WORKER_URLS).map(section => (
          <button
            key={section}
            className={activeSection === section ? 'active' : ''}
            onClick={() => setActiveSection(section)}
          >
            {section.charAt(0).toUpperCase() + section.slice(1)}
          </button>
        ))}
        <button className="clear-history" onClick={clearHistory}>
          Clear History
        </button>
      </div>

      <div className="chat-window" ref={chatWindowRef}>
        {messages.map(message => (
          <div key={message.id} className={`message ${message.type}`}>
            <div className="message-content">
              {message.type === 'user' ? (
                <div className="user-message">
                  <div className="user-avatar">You</div>
                  <div className="message-text">{message.content}</div>
                </div>
              ) : (
                <div className={`bot-message ${message.isError ? 'error' : ''}`}>
                  {message.responseData?.usedContext && (
                    <div className="context-badge">Using conversation context</div>
                  )}
                  <div className="message-text">{message.content}</div>
                  {message.responseData && (
                    <div className="message-data">
                      <div className="sql-query">
                        <strong>SQL:</strong> {message.responseData.sql}
                      </div>
                      {renderDataTable(message.responseData.rawData)}
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        ))}
        {isLoading && (
          <div className="typing-indicator">
            <div className="dot"></div>
            <div className="dot"></div>
            <div className="dot"></div>
          </div>
        )}
      </div>

      <div className="input-area">
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Ask about research, students, etc..."
          onKeyPress={(e) => e.key === 'Enter' && handleSend()}
          disabled={isLoading}
        />
        <button 
          onClick={handleSend}
          disabled={isLoading || !input.trim()}
        >
          Send
        </button>
      </div>
    </div>
  );
};
//not working
export default Chatbot;