function onFormSubmit() {
  // ==== CONFIG ====
  const GITHUB_TOKEN = "YOUR_GITHUB_TOKEN";
  const OWNER = "GITHUB_NAME";
  const REPO = "GITHUB_REPO";
  const FILE_PATH = "FILE_PATH";
  const INDEX_HEADER = "INDEX_HEADER";
  // =================

  const spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = spreadsheet.getSheetByName("Form Responses 1");

  const data = sheet.getDataRange().getValues().slice(1);
  data.forEach(row => 
  {
    try 
    {
      if (!row || row.length === 0 || row[0] === null || row[0] === "") 
        return;

      const timestamp = row[1];
      var tempID = row[2];
      const teacher = row[3];
      const courseCH = row[4];
      const courseEN = row[5];
      const platform = row[6] || "";
      const resourceLink = row[7] || "";
      const attendanceRes = `${row[8]} ${row[9] || ""}`.trim();
      const attendance = attendanceRes.includes('是') || attendanceRes.includes('Yes') ? '會點名' : '不會點名';
      const contributor = row[20] || "anonymous";
      
      // Remove spaces
      tempID = tempID.replace(/\s/g, "");
      const classID = tempID;

      // The grading thingy
      const assignments = row.slice(10, 20).filter(v => v).map(v => {
          const parts = v.toString().split(/\s+/).filter(part => part);
          return `| ${parts.join(' | ')} |`;
      }).join("\n") || "";

      const prefix = (classID.match(/^[A-Za-z]+/) || [""])[0];

      // Construct optionals
      const linkLine = resourceLink ? `> [資源連結](${resourceLink})` : `> 沒有資源`;
      const platformLine = platform ? ` | ==用 ${platform}==` : "";

      // Markdown entry
      const entry = `### ${classID} | **${teacher}** | ${courseCH}，${courseEN}
  ${linkLine}${platformLine} **${contributor}**
  - ${attendance}
  - 其他

  ${assignments ? `| 作業 / 考試 | 次數     | 總成績佔比  |\n|-----------|----------|-----------|\n${assignments}` : ""}
  `;

      // Step 1: Get current file from GitHubmain
      const fileUrl = `https://api.github.com/repos/sharing-blog/${REPO}/contents/${FILE_PATH}`;
      const headers = { 
          Authorization: `token ${GITHUB_TOKEN}`, 
          Accept: "application/vnd.github.v3+json" 
      };
      
      let res, fileData, content;
      try 
      {
        res = UrlFetchApp.fetch(fileUrl, { headers, muteHttpExceptions: true });
        if (res.getResponseCode() !== 200) 
          throw new Error(`Failed to fetch file: ${res.getContentText()}`);

        fileData = JSON.parse(res.getContentText());
        content = Utilities.newBlob(Utilities.base64Decode(fileData.content)).getDataAsString();
      } 
      catch (e) 
      {
        console.error(`Error fetching file: ${e.message}`);
        return;
      }

      // Hella hard, wtf
      // Step 2: Update markdown
      // Check if already exist
      const courseExists = content.includes(`### ${classID} |`);
      if (!courseExists) 
      {
        // New prefix
        if (!content.includes(`# ${prefix}`)) 
        {
          // Get all prefixes to maintain topological order
          const prefixPattern = /# ([A-Za-z]+)\n/g;
          const existingPrefixes = [];
          let match;
          while ((match = prefixPattern.exec(content)) !== null) 
            existingPrefixes.push(match[1]);

          // Find insertion point
          let insertionPoint = existingPrefixes.findIndex((p) => p > prefix);
          if (insertionPoint === -1) insertionPoint = existingPrefixes.length;

          // Build new index entry
          const indexEntry = `- [${prefix}](#${prefix})\n`;

          // Insert into index section
          const indexRegex = new RegExp(
            `(${INDEX_HEADER}[^\\n]*\\n)([\\s\\S]*?)(?=\\n#|$)`,
          );
          content = content.replace(indexRegex, (match, header, links) => {
            // Split into non-empty lines and trim whitespace
            let linkLines = links
              .split("\n")
              .filter((l) => l.trim())
              .map((l) => l.trim());

            // Add new entry if it doesn't exist
            if (!linkLines.includes(indexEntry.trim()))
              linkLines.push(indexEntry.trim());

            // Sort alphabetically, keeping Template first
            linkLines.sort((a, b) => {
              const aLower = a.toLowerCase();
              const bLower = b.toLowerCase();
              if (aLower.includes("template")) return -1;
              if (bLower.includes("template")) return 1;
              return aLower.localeCompare(bLower);
            });

            // Due to regex formatting ## Prefix.... will move down
            // Swap to top and return
            return header + '\n' + [
              linkLines.pop(),
              ...linkLines
            ].join('\n').trim();
          });

          // Find insertion point for new section
          let insertPos = content.length;
          
          // Get all sections after # Markdown
          const sectionRegex = /^# ([A-Za-z]+)$/gm;
          const allSections = [];
          let sectionMatch;
          
          while ((sectionMatch = sectionRegex.exec(content)) !== null) 
          {
            const sectionName = sectionMatch[1];
            if (sectionName !== 'Index' && sectionName !== 'Markdown') 
            {
              allSections.push({
                  name: sectionName,
                  position: sectionMatch.index
              });
            }
          }

          // Find first section that comes after our prefix alphabetically
          const nextSection = allSections.find(s => s.name > prefix);
          insertPos = nextSection ? nextSection.position : insertPos;
          
          // Ensure we insert after Markdown section
          const markdownEnd = content.indexOf('\n', content.indexOf('# Markdown')) + 1;
          if (insertPos < markdownEnd)
            insertPos = markdownEnd;

          // Insert new section
          const newSection = `# ${prefix}\n${entry}\n\n`;
          content = content.slice(0, insertPos) + newSection + content.slice(insertPos);
        }
        // Add details to existing prefix
        else 
        {
          const prefixSectionRegex = new RegExp(`(# ${prefix}[\\s\\S]*?)(?=\\n# |$)`);
          const prefixSectionMatch = content.match(prefixSectionRegex);
          if (prefixSectionMatch) 
          {
            const prefixSection = prefixSectionMatch[0];
            const courseEntries = prefixSection.split(/\n(?=###)/);
            const header = courseEntries.shift();
            
            // Add new entry and sort by courseID
            courseEntries.push(entry);
            courseEntries.sort((a, b) => {
                const idA = a.match(/### (\S+)/)[1];
                const idB = b.match(/### (\S+)/)[1];
                return idA.localeCompare(idB);
            });
            
            // Rebuild section
            const newPrefixSection = [header, ...courseEntries].join('\n');
            content = content.replace(prefixSectionRegex, newPrefixSection);
          }
        }

        // Ensure UTF-8 encoding (Mandarin chars)
        content = Utilities.newBlob(content).getDataAsString('UTF-8');
      } 
      else 
        console.log(`Course ${classID} already exists, skipping...`);

      // Step 3: Create new branch
      const branchName = `add-${classID}`;
      const mainRefUrl = `https://api.github.com/repos/sharing-blog/${REPO}/git/ref/heads/main`;
      let mainRef = JSON.parse(UrlFetchApp.fetch(mainRefUrl, { headers }).getContentText());
      let sha;
      try 
      {
        res = UrlFetchApp.fetch(mainRefUrl, { headers, muteHttpExceptions: true });
        if (res.getResponseCode() !== 200)
          throw new Error(`Failed to get main ref: ${res.getContentText()}`);
        mainRef = JSON.parse(res.getContentText());
        sha = mainRef.object.sha;
      } 
      catch (e) 
      {
        console.error(`Error getting main ref: ${e.message}`);
        return;
      }

      const createBranchUrl = `https://api.github.com/repos/sharing-blog/${REPO}/git/refs`;
      try 
      {
        res = UrlFetchApp.fetch(createBranchUrl, {
          method: "post",
          headers,
          payload: JSON.stringify({
            ref: `refs/heads/${branchName}`,
            sha: sha
          }),
          muteHttpExceptions: true
        });
        
        // Handle branch creation response
        if (res.getResponseCode() === 422) 
        {
          const errorResponse = JSON.parse(res.getContentText());
          if (errorResponse.message === "Reference already exists")
            console.log(`Branch ${branchName} already exists, continuing...`);
          else
            throw new Error(`Failed to create branch: ${res.getContentText()}`);
        } 
        else if (res.getResponseCode() !== 201) 
          throw new Error(`Failed to create branch: ${res.getContentText()}`);
      
      } 
      catch (e) 
      {
        console.error(`Error creating branch: ${e.message}`);
        return;
      }

      // Step 4: Commit updated file to existing or new branch
      const updateUrl = `https://api.github.com/repos/sharing-blog/${REPO}/contents/${FILE_PATH}`;
      // Commit regardless of whether branch exists or not
      console.log(`Committing to branch: ${branchName}`);

      const updateFileWithRetry = (url, content, maxRetries = 3) => {
        let attempts = 0;
        let lastError;
        
        while (attempts < maxRetries) 
        {
          try 
          {
            // Get new file data from the TARGET BRANCH before each attempt
            const fileUrlWithBranch = `https://api.github.com/repos/sharing-blog/${REPO}/contents/${FILE_PATH}?ref=${branchName}`;
            const freshFileData = JSON.parse(UrlFetchApp.fetch(fileUrlWithBranch, { headers }).getContentText());
            const freshSha = freshFileData.sha;
            
            const utf8Bytes = Utilities.newBlob(content).getBytes();
            const base64Content = Utilities.base64Encode(utf8Bytes);
            
            // Generate ceonventional commit
            const timestamp = new Date().toLocaleString();
            const commitMessage = attempts === 0 
              ? `feat: Add form entry ${classID}\n\n- Updated at ${timestamp}\n- Source: Google Forms` 
              : `feat: Add form entry ${classID} (retry ${attempts})\n\n- Updated at ${timestamp}\n- Source: Google Forms`;
            
            const res = UrlFetchApp.fetch(url, {
              method: "put",
              headers,
              payload: JSON.stringify({
                message: commitMessage,
                content: base64Content,
                sha: freshSha, // Always use the latest SHA
                branch: branchName,
                author: {
                  name: "Apps Script Bot",
                  email: "forms@yoursite.com"
                }
              }),
              muteHttpExceptions: true
            });
            
            if (res.getResponseCode() === 200 || res.getResponseCode() === 201) 
            {
              const responseData = JSON.parse(res.getContentText());
              console.log(`Committed: ${responseData.commit.sha.substring(0, 7)} - ${classID}`);
              console.log(`Branch: ${branchName}`);
              console.log(`File updated: ${responseData.content.html_url}`);
              return true; // Success
            }
            
            if (res.getResponseCode() === 409) 
            {
              lastError = `Version conflict (attempt ${attempts + 1})`;
              Utilities.sleep(1000 * (attempts + 1)); // Exponential backoff
            } 
            else
              throw new Error(`HTTP ${res.getResponseCode()}: ${res.getContentText()}`);
          } 
          catch (e) 
          {
            lastError = e.message;
          }
          attempts++;
        }
        
        throw new Error(`Failed after ${maxRetries} attempts: ${lastError}`);
      };

      try 
      {
        updateFileWithRetry(updateUrl, content);
        console.log(`Successfully committed changes to ${branchName}`);
      } 
      catch (e) 
      {
        console.error(`Failed to commit: ${e.message}`);
        return;
      }
    }
    catch (e) 
    {
      console.error(`Error processing row: ${e.message}`);
    }
  });
}
